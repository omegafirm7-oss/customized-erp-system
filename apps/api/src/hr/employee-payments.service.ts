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
      include: { recoveries: { orderBy: { recoveryDate: "desc" } } },
    });
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

        const isAllowance = dto.category === EmployeePaymentCategory.ALLOWANCE;
        const isSalary = dto.category === EmployeePaymentCategory.SALARY;
        let debitAccount: { id: string };
        if (isAllowance) {
          debitAccount = dto.expenseAccountId
            ? await this.accountResolution.getExpenseAccount(tx, companyId, dto.expenseAccountId)
            : await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.ALLOWANCE_EXPENSE);
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
            expenseAccountId: isAllowance || isSalary ? debitAccount.id : null,
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
        if (payment.category === EmployeePaymentCategory.ALLOWANCE || payment.category === EmployeePaymentCategory.SALARY) {
          throw new ConflictException("Allowance/Salary payments are a straight expense — nothing to recover");
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
}
