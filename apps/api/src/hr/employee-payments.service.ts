import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ControlAccountType, DocumentType, EmployeePaymentCategory, JournalSourceModule, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService } from "../gl/gl-posting.service";
import { NumberingService } from "../numbering/numbering.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { CreateEmployeePaymentDto, RecordPaymentRecoveryDto } from "./dto/hr.dtos";

const ZERO = new Prisma.Decimal(0);

/**
 * Informal, ad-hoc cash paid to an employee outside formal payroll —
 * allowances (a straight expense) and advances/other (recovered over time,
 * mirroring EmployeeLoan's control account but without a fixed installment
 * schedule). Kept deliberately separate from EmployeeLoan, which remains
 * the formal, payroll-deducted advance path.
 */
@Injectable()
export class EmployeePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly numberingService: NumberingService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  async listForEmployee(companyId: string, employeeId: string) {
    return this.prisma.employeePayment.findMany({
      where: { companyId, employeeId },
      orderBy: { paymentDate: "desc" },
      include: {
        recoveries: { orderBy: { recoveryDate: "desc" } },
        // Metadata only — the actual bytes are fetched on demand via the
        // dedicated receipt endpoint, never inlined into the list payload.
        attachment: { select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } },
      },
    });
  }

  private static readonly ALLOWED_RECEIPT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);

  /** Attaches (or replaces) the receipt/evidence file for a payment. */
  async uploadReceipt(companyId: string, paymentId: string, userId: string, file: Express.Multer.File) {
    if (!EmployeePaymentsService.ALLOWED_RECEIPT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Receipt must be an image (JPEG/PNG/WEBP/GIF) or a PDF");
    }
    const payment = await this.prisma.employeePayment.findFirst({ where: { id: paymentId, companyId } });
    if (!payment) {
      throw new NotFoundException("Payment not found");
    }

    const attachment = await this.prisma.employeePaymentAttachment.upsert({
      where: { employeePaymentId: paymentId },
      create: {
        companyId,
        employeePaymentId: paymentId,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploadedByUserId: userId,
      },
      update: {
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploadedByUserId: userId,
      },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    });

    await this.auditService.log({
      companyId,
      entityName: "EmployeePaymentAttachment",
      entityId: attachment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: attachment,
    });

    return attachment;
  }

  async getReceipt(companyId: string, paymentId: string) {
    const attachment = await this.prisma.employeePaymentAttachment.findFirst({
      where: { employeePaymentId: paymentId, companyId },
    });
    if (!attachment) {
      throw new NotFoundException("No receipt attached to this payment");
    }
    return attachment;
  }

  async create(companyId: string, employeeId: string, userId: string, dto: CreateEmployeePaymentDto) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId } });
        if (!employee) {
          throw new NotFoundException("Employee not found");
        }
        const amount = new Prisma.Decimal(dto.amount);
        if (amount.lte(0)) {
          throw new BadRequestException("Amount must be positive");
        }

        // FOOD is tracked separately from ALLOWANCE — same straight-expense
        // shape, but defaults to its own control account (5216) so the two
        // never mix in cost reporting.
        const isAllowance = dto.category === EmployeePaymentCategory.ALLOWANCE;
        const isFood = dto.category === EmployeePaymentCategory.FOOD;
        const isSalary = dto.category === EmployeePaymentCategory.SALARY;
        let debitAccount: { id: string };
        if (isAllowance || isFood) {
          debitAccount = dto.expenseAccountId
            ? await this.accountResolution.getExpenseAccount(tx, companyId, dto.expenseAccountId)
            : await this.accountResolution.getControlAccount(
                tx,
                companyId,
                isFood ? ControlAccountType.FOOD_EXPENSE : ControlAccountType.ALLOWANCE_EXPENSE,
              );
        } else if (isSalary) {
          const project = employee.costCenterId
            ? await tx.project.findFirst({ where: { companyId, costCenterId: employee.costCenterId } })
            : null;
          const projectSalaryExp = project
            ? await this.accountResolution
                .getControlAccount(tx, companyId, ControlAccountType.PROJECT_SALARY_EXPENSE)
                .catch(() => null)
            : null;
          debitAccount =
            projectSalaryExp ?? (await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.SALARY_EXPENSE));
        } else {
          debitAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EMPLOYEE_LOANS);
        }
        const bankCashAccount = await this.accountResolution.getBankOrCashAccount(tx, companyId, dto.bankCashAccountId);
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
        const paymentId = randomUUID();
        const paymentNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.EMPLOYEE_PAYMENT,
          fiscalYearId: null,
        });

        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: paymentDate,
          documentDate: paymentDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: paymentId,
          memo: `${paymentNumber} — ${dto.category} — ${employee.code} ${employee.nameEn}`,
          lines: [
            {
              accountId: debitAccount.id,
              debit: amount,
              credit: ZERO,
              amountInTransactionCurrency: amount,
              costCenterId: employee.costCenterId,
              description: `${dto.category} payment — ${employee.code}`,
            },
            {
              accountId: bankCashAccount.id,
              debit: ZERO,
              credit: amount,
              amountInTransactionCurrency: amount,
              description: `${dto.category} payment — ${employee.code}`,
            },
          ],
        });

        return tx.employeePayment.create({
          data: {
            id: paymentId,
            companyId,
            employeeId,
            paymentNumber,
            category: dto.category,
            amount,
            paymentDate,
            bankCashAccountId: bankCashAccount.id,
            expenseAccountId: isAllowance || isFood || isSalary ? debitAccount.id : null,
            memo: dto.memo,
            journalEntryId: entry.id,
            createdByUserId: userId,
          },
          include: { recoveries: true },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "EmployeePayment",
      entityId: result.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: result,
    });

    return result;
  }

  /** Records one repayment against an ADVANCE/OTHER payment until its pending balance clears. */
  async recordRecovery(companyId: string, paymentId: string, userId: string, dto: RecordPaymentRecoveryDto) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.employeePayment.findFirst({
          where: { id: paymentId, companyId },
          include: { employee: { select: { code: true, nameEn: true } } },
        });
        if (!payment) {
          throw new NotFoundException("Payment not found");
        }
        if (
          payment.category === EmployeePaymentCategory.ALLOWANCE ||
          payment.category === EmployeePaymentCategory.SALARY ||
          payment.category === EmployeePaymentCategory.FOOD
        ) {
          throw new ConflictException("Allowance/Salary/Food payments are a straight expense — nothing to recover");
        }
        if (payment.reversedAt) {
          throw new ConflictException("This payment was reversed");
        }
        const amount = new Prisma.Decimal(dto.amount);
        const pending = payment.amount.sub(payment.recoveredAmount);
        if (amount.lte(0)) {
          throw new BadRequestException("Recovery amount must be positive");
        }
        if (amount.gt(pending)) {
          throw new BadRequestException(`Recovery exceeds the pending balance (${pending.toString()})`);
        }

        const loansCtl = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EMPLOYEE_LOANS);
        const bankCashAccount = await this.accountResolution.getBankOrCashAccount(tx, companyId, dto.bankCashAccountId);
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const recoveryDate = dto.recoveryDate ? new Date(dto.recoveryDate) : new Date();
        const recoveryId = randomUUID();

        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: recoveryDate,
          documentDate: recoveryDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: recoveryId,
          memo: `Recovery against ${payment.paymentNumber} — ${payment.employee.code} ${payment.employee.nameEn}`,
          lines: [
            {
              accountId: bankCashAccount.id,
              debit: amount,
              credit: ZERO,
              amountInTransactionCurrency: amount,
              description: `Recovery — ${payment.employee.code}`,
            },
            {
              accountId: loansCtl.id,
              debit: ZERO,
              credit: amount,
              amountInTransactionCurrency: amount,
              description: `Recovery — ${payment.employee.code}`,
            },
          ],
        });

        await tx.employeePaymentRecovery.create({
          data: {
            id: recoveryId,
            companyId,
            employeePaymentId: payment.id,
            amount,
            recoveryDate,
            bankCashAccountId: bankCashAccount.id,
            memo: dto.memo,
            journalEntryId: entry.id,
            createdByUserId: userId,
          },
        });

        return tx.employeePayment.update({
          where: { id: payment.id },
          data: { recoveredAmount: payment.recoveredAmount.add(amount) },
          include: { recoveries: { orderBy: { recoveryDate: "desc" } } },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "EmployeePaymentRecovery",
      entityId: result.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: result,
    });

    return result;
  }

  /**
   * Corrects a wrongly-recorded payment (wrong category/amount/employee)
   * via a reversing JE, rather than a hard delete — keeps the audit trail
   * and stays consistent with how PayrollRun/FinalSettlement are reversed.
   * Reversed payments are excluded from every paid/pending aggregation.
   */
  async reversePayment(companyId: string, paymentId: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.employeePayment.findFirst({ where: { id: paymentId, companyId } });
      if (!payment) {
        throw new NotFoundException("Payment not found");
      }
      if (payment.reversedAt) {
        throw new ConflictException("Payment already reversed");
      }
      if (payment.recoveredAmount.gt(0)) {
        throw new ConflictException("Cannot reverse a payment that already has recoveries recorded against it");
      }

      await this.glPostingService.reverseEntryInTx(tx, companyId, payment.journalEntryId, userId);

      return tx.employeePayment.update({
        where: { id: payment.id },
        data: { reversedAt: new Date() },
        include: { recoveries: true },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "EmployeePayment",
      entityId: result.id,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: result,
    });

    return result;
  }

  /**
   * Every posted, non-reversed ALLOWANCE-category payment, plus every FOOD
   * payment that isn't already sitting on the company's current Food
   * Expense account (a leftover from before Food/Allowance were split into
   * separate control accounts — same payment, same category, wrong GL
   * account) — the worklist behind the "reclassify" tool.
   */
  async allowancePayments(companyId: string) {
    const foodAccount = await this.accountResolution.getControlAccount(
      this.prisma,
      companyId,
      ControlAccountType.FOOD_EXPENSE,
    );
    const payments = await this.prisma.employeePayment.findMany({
      where: {
        companyId,
        reversedAt: null,
        OR: [
          { category: EmployeePaymentCategory.ALLOWANCE },
          { category: EmployeePaymentCategory.FOOD, expenseAccountId: { not: foodAccount.id } },
        ],
      },
      orderBy: { paymentDate: "desc" },
      select: {
        id: true,
        category: true,
        amount: true,
        paymentDate: true,
        memo: true,
        employee: { select: { id: true, code: true, nameEn: true } },
        expenseAccount: { select: { id: true, code: true, name: true } },
      },
    });
    return payments.map((p) => ({
      paymentId: p.id,
      category: p.category,
      employeeId: p.employee.id,
      employeeCode: p.employee.code,
      employeeName: p.employee.nameEn,
      amount: p.amount,
      paymentDate: p.paymentDate,
      memo: p.memo,
      currentAccountId: p.expenseAccount?.id ?? null,
      currentAccountCode: p.expenseAccount?.code ?? null,
      currentAccountName: p.expenseAccount?.name ?? null,
    }));
  }

  /**
   * Moves a posted payment's expense allocation to a different account —
   * e.g. correcting a batch of ALLOWANCE payments that were really Food, so
   * the Food expense account carries the true historical total. Posted
   * entries are immutable by design (see the DB trigger), so this can't be
   * a quiet in-place edit: it reverses the original entry and records a new
   * one, identical in every way (employee, category, amount, date,
   * bank/cash account, memo) except the expense account — a visible,
   * auditable correction rather than a silent rewrite of history.
   */
  async reclassifyAccount(companyId: string, paymentId: string, userId: string, newExpenseAccountId: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.employeePayment.findFirst({ where: { id: paymentId, companyId } });
        if (!payment) {
          throw new NotFoundException("Payment not found");
        }
        if (payment.reversedAt) {
          throw new ConflictException("Payment already reversed");
        }
        if (payment.category !== EmployeePaymentCategory.ALLOWANCE && payment.category !== EmployeePaymentCategory.FOOD) {
          throw new ConflictException("Only Allowance/Food payments can be reclassified to a different expense account");
        }
        if (payment.recoveredAmount.gt(0)) {
          throw new ConflictException("Cannot reclassify a payment that already has recoveries recorded against it");
        }

        const newAccount = await this.accountResolution.getExpenseAccount(tx, companyId, newExpenseAccountId);
        const employee = await tx.employee.findFirstOrThrow({ where: { id: payment.employeeId, companyId } });
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });

        await this.glPostingService.reverseEntryInTx(tx, companyId, payment.journalEntryId, userId);
        await tx.employeePayment.update({ where: { id: payment.id }, data: { reversedAt: new Date() } });

        const newPaymentId = randomUUID();
        const paymentNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.EMPLOYEE_PAYMENT,
          fiscalYearId: null,
        });
        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: payment.paymentDate,
          documentDate: payment.paymentDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: newPaymentId,
          memo: `${paymentNumber} — ${payment.category} — ${employee.code} ${employee.nameEn} (reclassified from ${payment.paymentNumber})`,
          lines: [
            {
              accountId: newAccount.id,
              debit: payment.amount,
              credit: new Prisma.Decimal(0),
              amountInTransactionCurrency: payment.amount,
              costCenterId: employee.costCenterId,
              description: `${payment.category} payment — ${employee.code} (reclassified)`,
            },
            {
              accountId: payment.bankCashAccountId,
              debit: new Prisma.Decimal(0),
              credit: payment.amount,
              amountInTransactionCurrency: payment.amount,
              description: `${payment.category} payment — ${employee.code} (reclassified)`,
            },
          ],
        });

        return tx.employeePayment.create({
          data: {
            id: newPaymentId,
            companyId,
            employeeId: payment.employeeId,
            paymentNumber,
            category: payment.category,
            amount: payment.amount,
            paymentDate: payment.paymentDate,
            bankCashAccountId: payment.bankCashAccountId,
            expenseAccountId: newAccount.id,
            memo: payment.memo,
            journalEntryId: entry.id,
            createdByUserId: userId,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "EmployeePayment",
      entityId: result.id,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: result,
    });

    return result;
  }

  /**
   * Reclassifies every FOOD payment not already on the company's current
   * Food Expense account onto it, one reversal+repost per payment — the
   * mechanical fix for the pre-split leftover described on
   * allowancePayments(). Unlike a single reclassify, this one doesn't need
   * per-transaction judgment (the target account is unambiguous: FOOD
   * payments belong on FOOD_EXPENSE), so it's offered as one confirmed bulk
   * action instead of 50+ individual clicks.
   */
  async bulkReclassifyFoodToDefaultAccount(companyId: string, userId: string) {
    const foodAccount = await this.accountResolution.getControlAccount(
      this.prisma,
      companyId,
      ControlAccountType.FOOD_EXPENSE,
    );
    const mismatched = await this.prisma.employeePayment.findMany({
      where: {
        companyId,
        category: EmployeePaymentCategory.FOOD,
        reversedAt: null,
        expenseAccountId: { not: foodAccount.id },
      },
      select: { id: true },
    });

    const reclassified: { paymentId: string; amount: string }[] = [];
    for (const payment of mismatched) {
      const result = await this.reclassifyAccount(companyId, payment.id, userId, foodAccount.id);
      reclassified.push({ paymentId: result.id, amount: result.amount.toString() });
    }

    return {
      count: reclassified.length,
      totalAmount: reclassified.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(2),
      reclassified,
    };
  }
}
