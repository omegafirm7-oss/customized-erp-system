import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  EmployeeStatus,
  JournalSourceModule,
  LoanStatus,
  PayrollRunStatus,
  Prisma,
  SettlementReason,
  SettlementStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { NumberingService } from "../numbering/numbering.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { RecordSettlementPaymentDto } from "./dto/hr.dtos";
import {
  computeEosbPayable,
  computeLeaveAccruedDays,
  computeLeaveProvision,
  fullGross,
  serviceYears,
  wageForBasis,
  EosbBasisKind,
  SettlementReasonKind,
} from "./payroll-math";

type TxClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

export interface SettlementFigures {
  serviceYears: Prisma.Decimal;
  /** Salary for days worked in the final (not yet payrolled) month. */
  finalSalaryDays: number;
  finalSalaryAmount: Prisma.Decimal;
  eosbEntitlement: Prisma.Decimal;
  eosbFactorApplied: string;
  eosbAmount: Prisma.Decimal;
  leaveBalanceDays: Prisma.Decimal;
  leavePayoutAmount: Prisma.Decimal;
  loanRecovery: Prisma.Decimal;
  eosbProvisionCleared: Prisma.Decimal;
  leaveProvisionCleared: Prisma.Decimal;
  netAmount: Prisma.Decimal;
}

@Injectable()
export class TerminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly numberingService: NumberingService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  async preview(companyId: string, employeeId: string, reason: SettlementReason, lastWorkingDay: Date) {
    return this.computeFigures(this.prisma, companyId, employeeId, reason, lastWorkingDay);
  }

  async postSettlement(
    companyId: string,
    employeeId: string,
    userId: string,
    reason: SettlementReason,
    lastWorkingDay: Date,
  ) {
    const settlement = await this.prisma.$transaction(
      async (tx) => {
        const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId } });
        if (!employee) {
          throw new NotFoundException("Employee not found");
        }
        if (employee.status !== EmployeeStatus.ACTIVE) {
          throw new ConflictException("Employee is already terminated");
        }
        const draftWithEmployee = await tx.payrollRun.findFirst({
          where: { companyId, status: PayrollRunStatus.DRAFT, lines: { some: { employeeId } } },
        });
        if (draftWithEmployee) {
          throw new ConflictException(
            "Employee is included in a draft payroll run — post or delete that run first",
          );
        }

        const figures = await this.computeFigures(tx, companyId, employeeId, reason, lastWorkingDay);

        const [salaryExp, projectSalaryExp, eosbExp, leaveExp, eosbProv, leaveProv, loansCtl, salariesPay] = await Promise.all([
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.SALARY_EXPENSE),
          this.accountResolution
            .getControlAccount(tx, companyId, ControlAccountType.PROJECT_SALARY_EXPENSE)
            .catch(() => null),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EOSB_EXPENSE),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.LEAVE_EXPENSE),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EOSB_PROVISION),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.LEAVE_PROVISION),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EMPLOYEE_LOANS),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.SALARIES_PAYABLE),
        ]);

        const cc = employee.costCenterId;
        let salaryAccountId = salaryExp.id;
        if (cc && projectSalaryExp) {
          const project = await tx.project.findFirst({ where: { companyId, costCenterId: cc } });
          if (project) salaryAccountId = projectSalaryExp.id;
        }
        const lines: PostedEntryLineInput[] = [];
        const pushSigned = (
          accountId: string,
          amount: Prisma.Decimal,
          costCenterId: string | null,
          description: string,
        ) => {
          if (amount.isZero()) return;
          const abs = amount.abs();
          lines.push({
            accountId,
            debit: amount.gt(0) ? abs : ZERO,
            credit: amount.gt(0) ? ZERO : abs,
            amountInTransactionCurrency: abs,
            costCenterId,
            description,
          });
        };

        // Final month worked days — straight salary expense
        pushSigned(salaryAccountId, figures.finalSalaryAmount, cc, "Final salary days");
        // EOSB: clear the provision built to date; the gap between the
        // amount payable (with Art. 85 factor) and the provision is a
        // catch-up expense (or credit for forfeited resignations).
        pushSigned(eosbProv.id, figures.eosbProvisionCleared, null, "EOSB provision clearance");
        pushSigned(eosbExp.id, figures.eosbAmount.sub(figures.eosbProvisionCleared), cc, "EOSB settlement catch-up");
        // Leave: same pattern
        pushSigned(leaveProv.id, figures.leaveProvisionCleared, null, "Leave provision clearance");
        pushSigned(
          leaveExp.id,
          figures.leavePayoutAmount.sub(figures.leaveProvisionCleared),
          cc,
          "Leave payout catch-up",
        );
        // Outstanding loans recovered from the settlement
        pushSigned(loansCtl.id, figures.loanRecovery.neg(), null, "Loan balance recovery");
        // Net owed to the employee
        pushSigned(salariesPay.id, figures.netAmount.neg(), null, "Final settlement payable");

        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const settlementId = randomUUID();
        const settlementNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.FINAL_SETTLEMENT,
          fiscalYearId: null,
        });

        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: lastWorkingDay,
          documentDate: new Date(),
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: settlementId,
          memo: `Final settlement ${settlementNumber} — ${employee.code} ${employee.nameEn} (${reason})`,
          lines,
        });

        // Loans are recovered in full through the settlement
        await tx.employeeLoan.updateMany({
          where: { employeeId, status: LoanStatus.ACTIVE },
          data: { balance: ZERO, status: LoanStatus.SETTLED },
        });

        await tx.employee.update({
          where: { id: employeeId },
          data: { status: EmployeeStatus.TERMINATED, terminationDate: lastWorkingDay, updatedByUserId: userId },
        });

        const settlementData = {
          settlementNumber,
          reason,
          lastWorkingDay,
          serviceYears: figures.serviceYears.toDecimalPlaces(4),
          finalSalaryAmount: figures.finalSalaryAmount,
          eosbAmount: figures.eosbAmount,
          leavePayoutAmount: figures.leavePayoutAmount,
          loanRecovery: figures.loanRecovery,
          netAmount: figures.netAmount,
          eosbProvisionCleared: figures.eosbProvisionCleared,
          leaveProvisionCleared: figures.leaveProvisionCleared,
          journalEntryId: entry.id,
          createdByUserId: userId,
        };

        // An employee can only ever hold one FinalSettlement row (1:1 by
        // schema). If they were released before, reversed, and are now
        // being released again, reuse that row rather than trying to
        // insert a second one — reversal already guarantees it carries no
        // payments (recordSettlementPayment blocks reversal once any
        // exist), so there's nothing from the prior release to lose.
        const existing = await tx.finalSettlement.findFirst({ where: { employeeId, companyId } });
        if (existing) {
          return tx.finalSettlement.update({
            where: { id: existing.id },
            data: { ...settlementData, paidAmount: ZERO, reversalJournalEntryId: null, status: SettlementStatus.POSTED },
            include: { employee: { select: { code: true, nameEn: true } } },
          });
        }
        return tx.finalSettlement.create({
          data: { id: settlementId, companyId, employeeId, ...settlementData },
          include: { employee: { select: { code: true, nameEn: true } } },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "FinalSettlement",
      entityId: settlement.id,
      action: "POST",
      changedByUserId: userId,
      afterSnapshot: settlement,
    });

    return settlement;
  }

  async reverseSettlement(companyId: string, settlementId: string, userId: string) {
    const reversed = await this.prisma.$transaction(
      async (tx) => {
        const settlement = await tx.finalSettlement.findFirst({ where: { id: settlementId, companyId } });
        if (!settlement) {
          throw new NotFoundException("Settlement not found");
        }
        if (settlement.status !== SettlementStatus.POSTED) {
          throw new ConflictException("Settlement is already reversed");
        }
        const paymentCount = await tx.settlementPayment.count({ where: { finalSettlementId: settlementId } });
        if (paymentCount > 0) {
          throw new ConflictException(
            "Payments have already been recorded against this settlement — it can no longer be reversed",
          );
        }

        await this.glPostingService.reverseEntryInTx(tx, companyId, settlement.journalEntryId, userId);
        const reversalEntry = await tx.journalEntry.findFirstOrThrow({
          where: { reversalOfEntryId: settlement.journalEntryId },
          select: { id: true },
        });

        // Note: loan balances are NOT restored automatically — the recovery
        // amounts are in the reversal JE; re-issue loans manually if needed.
        await tx.employee.update({
          where: { id: settlement.employeeId },
          data: { status: EmployeeStatus.ACTIVE, terminationDate: null, updatedByUserId: userId },
        });

        return tx.finalSettlement.update({
          where: { id: settlementId },
          data: { status: SettlementStatus.REVERSED, reversalJournalEntryId: reversalEntry.id },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "FinalSettlement",
      entityId: settlementId,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: reversed,
    });

    return reversed;
  }

  /**
   * Records one payout against a POSTED settlement — released employees are
   * often paid over time rather than in one lump sum. Each payment posts
   * its own JE (Dr Accrued Salaries Payable / Cr the chosen bank/cash
   * account) and increments the settlement's paidAmount.
   */
  async recordSettlementPayment(
    companyId: string,
    employeeId: string,
    userId: string,
    dto: RecordSettlementPaymentDto,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const settlement = await tx.finalSettlement.findFirst({
          where: { employeeId, companyId },
          include: { employee: { select: { code: true, nameEn: true } } },
        });
        if (!settlement) {
          throw new NotFoundException("This employee has no final settlement");
        }
        if (settlement.status !== SettlementStatus.POSTED) {
          throw new ConflictException("Settlement is not posted — nothing to pay");
        }
        const amount = new Prisma.Decimal(dto.amount);
        const pending = settlement.netAmount.sub(settlement.paidAmount);
        if (amount.lte(0)) {
          throw new BadRequestException("Payment amount must be positive");
        }
        if (amount.gt(pending)) {
          throw new BadRequestException(`Payment exceeds the pending balance (${pending.toString()})`);
        }

        const salariesPay = await this.accountResolution.getControlAccount(
          tx,
          companyId,
          ControlAccountType.SALARIES_PAYABLE,
        );
        const bankCashAccount = await this.accountResolution.getBankOrCashAccount(tx, companyId, dto.bankCashAccountId);
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
        const paymentId = randomUUID();

        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: paymentDate,
          documentDate: paymentDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: paymentId,
          memo: `Settlement ${settlement.settlementNumber} payment — ${settlement.employee.code} ${settlement.employee.nameEn}`,
          lines: [
            {
              accountId: salariesPay.id,
              debit: amount,
              credit: ZERO,
              amountInTransactionCurrency: amount,
              description: `Payout against ${settlement.settlementNumber}`,
            },
            {
              accountId: bankCashAccount.id,
              debit: ZERO,
              credit: amount,
              amountInTransactionCurrency: amount,
              description: `Settlement payout — ${settlement.employee.code}`,
            },
          ],
        });

        await tx.settlementPayment.create({
          data: {
            id: paymentId,
            companyId,
            finalSettlementId: settlement.id,
            amount,
            paymentDate,
            bankCashAccountId: bankCashAccount.id,
            memo: dto.memo,
            journalEntryId: entry.id,
            createdByUserId: userId,
          },
        });

        return tx.finalSettlement.update({
          where: { id: settlement.id },
          data: { paidAmount: settlement.paidAmount.add(amount) },
          include: { payments: { orderBy: { paymentDate: "desc" } } },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "SettlementPayment",
      entityId: result.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: result,
    });

    return result;
  }

  // ── Figures ──────────────────────────────────────────────────────────

  private async computeFigures(
    client: TxClient | PrismaService,
    companyId: string,
    employeeId: string,
    reason: SettlementReason,
    lastWorkingDay: Date,
  ): Promise<SettlementFigures> {
    const employee = await client.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    if (lastWorkingDay < employee.joinDate) {
      throw new BadRequestException("Last working day precedes the join date");
    }
    const settings = await client.hrSettings.findUniqueOrThrow({ where: { companyId } });
    const salary = {
      basicSalary: employee.basicSalary,
      housingAllowance: employee.housingAllowance,
      transportAllowance: employee.transportAllowance,
      otherAllowance: employee.otherAllowance,
    };

    const years = serviceYears(employee.joinDate, lastWorkingDay);
    const eosbWage = wageForBasis(salary, settings.eosbBasis as EosbBasisKind);
    const eosbAmount = computeEosbPayable(eosbWage, years, reason as SettlementReasonKind);

    // Provision balances built for this employee via POSTED payroll runs
    const prior = await client.payrollRunLine.aggregate({
      where: { employeeId, run: { status: PayrollRunStatus.POSTED } },
      _sum: { eosbDelta: true, leaveDelta: true, annualLeaveDaysTaken: true },
    });
    const eosbProvisionCleared = prior._sum.eosbDelta ?? ZERO;
    const leaveProvisionCleared = prior._sum.leaveDelta ?? ZERO;
    const priorLeaveTaken = prior._sum.annualLeaveDaysTaken ?? ZERO;

    // Salary for days worked in the settlement month (payroll covers whole
    // posted periods; this covers the stub since the last posted run).
    const lastPosted = await client.payrollRun.findFirst({
      where: { companyId, status: PayrollRunStatus.POSTED, lines: { some: { employeeId } } },
      include: { fiscalPeriod: true },
      orderBy: { fiscalPeriod: { startDate: "desc" } },
    });
    const coveredUntil = lastPosted ? lastPosted.fiscalPeriod.endDate : employee.joinDate;
    let finalSalaryDays = 0;
    if (lastWorkingDay > coveredUntil) {
      finalSalaryDays = Math.min(
        Math.ceil((lastWorkingDay.getTime() - coveredUntil.getTime()) / (24 * 3600 * 1000)),
        Number(settings.daysPerMonth),
      );
    }
    const finalSalaryAmount = fullGross(salary)
      .div(settings.daysPerMonth)
      .mul(finalSalaryDays)
      .toDecimalPlaces(2);

    const accruedDays = employee.leaveOpeningBalance.add(
      computeLeaveAccruedDays(employee.joinDate, lastWorkingDay, employee.annualLeaveDays),
    );
    const leaveBalanceDays = Prisma.Decimal.max(ZERO, accruedDays.sub(priorLeaveTaken)).toDecimalPlaces(2);
    const leavePayoutAmount = computeLeaveProvision(salary, leaveBalanceDays, settings.daysPerMonth);

    const loans = await client.employeeLoan.aggregate({
      where: { employeeId, status: LoanStatus.ACTIVE },
      _sum: { balance: true },
    });
    const loanRecovery = loans._sum.balance ?? ZERO;

    const netAmount = finalSalaryAmount.add(eosbAmount).add(leavePayoutAmount).sub(loanRecovery);
    if (netAmount.lt(0)) {
      throw new BadRequestException(
        `Outstanding loans (${loanRecovery}) exceed the settlement value — collect the difference separately before posting`,
      );
    }

    return {
      serviceYears: years,
      finalSalaryDays,
      finalSalaryAmount,
      eosbEntitlement: computeEosbPayable(eosbWage, years, "TERMINATION_BY_EMPLOYER"),
      eosbFactorApplied: reason,
      eosbAmount,
      leaveBalanceDays,
      leavePayoutAmount,
      loanRecovery,
      eosbProvisionCleared,
      leaveProvisionCleared,
      netAmount,
    };
  }
}
