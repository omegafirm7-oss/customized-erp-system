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
  FiscalPeriodStatus,
  JournalSourceModule,
  LoanStatus,
  PayrollRunStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { NumberingService } from "../numbering/numbering.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { HrSettingsService } from "./hr-settings.service";
import {
  computeEosbEntitlement,
  computeLeaveAccruedDays,
  computeLeaveProvision,
  computePayrollLine,
  serviceYears,
  wageForBasis,
  EosbBasisKind,
} from "./payroll-math";
import { UpdatePayrollLineDto } from "./dto/hr.dtos";

type TxClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

interface LoanSlice {
  loanId: string;
  amount: string;
}

interface ComputedLine {
  employeeId: string;
  costCenterId: string | null;
  basicSalary: Prisma.Decimal;
  housingAllowance: Prisma.Decimal;
  transportAllowance: Prisma.Decimal;
  otherAllowance: Prisma.Decimal;
  gosiBase: Prisma.Decimal;
  gosiEmployee: Prisma.Decimal;
  gosiEmployer: Prisma.Decimal;
  overtimePay: Prisma.Decimal;
  absenceDeduction: Prisma.Decimal;
  loanDeduction: Prisma.Decimal;
  loanBreakdown: LoanSlice[];
  grossPay: Prisma.Decimal;
  netPay: Prisma.Decimal;
  eosbEntitlementToDate: Prisma.Decimal;
  eosbDelta: Prisma.Decimal;
  leaveBalanceDays: Prisma.Decimal;
  leaveProvisionToDate: Prisma.Decimal;
  leaveDelta: Prisma.Decimal;
}

interface ExceptionInputs {
  unpaidDays: Prisma.Decimal;
  absentDays: Prisma.Decimal;
  overtimeHours: Prisma.Decimal;
  annualLeaveDaysTaken: Prisma.Decimal;
  otherDeduction: Prisma.Decimal;
  otherDeductionMemo: string | null;
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly numberingService: NumberingService,
    private readonly accountResolution: AccountResolutionService,
    private readonly hrSettingsService: HrSettingsService,
  ) {}

  // ── Queries ──────────────────────────────────────────────────────────

  async listRuns(companyId: string) {
    return this.prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async getRun(companyId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        lines: {
          orderBy: { employee: { code: "asc" } },
          include: {
            employee: { select: { code: true, nameEn: true, isSaudi: true, iban: true, bankCode: true } },
            costCenter: { select: { code: true } },
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    return run;
  }

  // ── Draft lifecycle ──────────────────────────────────────────────────

  async createDraftRun(companyId: string, userId: string, fiscalPeriodId: string) {
    const run = await this.prisma.$transaction(
      async (tx) => {
        const period = await this.getPeriod(tx, companyId, fiscalPeriodId);

        const existing = await tx.payrollRun.findFirst({
          where: {
            companyId,
            fiscalPeriodId,
            status: { in: [PayrollRunStatus.DRAFT, PayrollRunStatus.POSTED] },
          },
        });
        if (existing) {
          throw new ConflictException(
            existing.status === PayrollRunStatus.POSTED
              ? "A posted payroll run already exists for this period — reverse it first"
              : "A draft payroll run already exists for this period",
          );
        }

        const employees = await tx.employee.findMany({
          where: { companyId, status: EmployeeStatus.ACTIVE, joinDate: { lte: period.endDate } },
          orderBy: { code: "asc" },
        });
        if (employees.length === 0) {
          throw new BadRequestException("No active employees joined on or before this period");
        }

        const runId = randomUUID();
        const settings = await this.hrSettingsService.getInTx(tx, companyId);
        const rows: Array<{ line: ComputedLine; exceptions: ExceptionInputs }> = [];
        for (const employee of employees) {
          // Approved timesheets drive the default exceptions (still editable)
          const exceptions = await this.timesheetExceptions(tx, employee.id, period.startDate, period.endDate);
          rows.push({ line: await this.computeLine(tx, settings, employee, period.endDate, exceptions), exceptions });
        }

        await tx.payrollRun.create({
          data: {
            id: runId,
            companyId,
            fiscalPeriodId,
            status: PayrollRunStatus.DRAFT,
            createdByUserId: userId,
            ...this.sumTotals(rows.map((r) => r.line)),
          },
        });
        await tx.payrollRunLine.createMany({
          data: rows.map(({ line, exceptions }) => this.toLineRow(runId, companyId, line, exceptions)),
        });

        return runId;
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "PayrollRun",
      entityId: run,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { fiscalPeriodId },
    });

    return this.getRun(companyId, run);
  }

  async updateLine(companyId: string, runId: string, lineId: string, dto: UpdatePayrollLineDto) {
    await this.prisma.$transaction(
      async (tx) => {
        const run = await this.getDraftRun(tx, companyId, runId);
        const line = await tx.payrollRunLine.findFirst({
          where: { id: lineId, runId },
          include: { employee: true },
        });
        if (!line) {
          throw new NotFoundException("Payroll line not found");
        }
        const period = await this.getPeriod(tx, companyId, run.fiscalPeriodId);
        const settings = await this.hrSettingsService.getInTx(tx, companyId);

        const dec = (v: string | undefined, current: Prisma.Decimal) =>
          v !== undefined ? new Prisma.Decimal(v) : current;
        const exceptions: ExceptionInputs = {
          unpaidDays: dec(dto.unpaidDays, line.unpaidDays),
          absentDays: dec(dto.absentDays, line.absentDays),
          overtimeHours: dec(dto.overtimeHours, line.overtimeHours),
          annualLeaveDaysTaken: dec(dto.annualLeaveDaysTaken, line.annualLeaveDaysTaken),
          otherDeduction: dec(dto.otherDeduction, line.otherDeduction),
          otherDeductionMemo: dto.otherDeductionMemo !== undefined ? dto.otherDeductionMemo : line.otherDeductionMemo,
        };

        const computed = await this.computeLine(tx, settings, line.employee, period.endDate, exceptions);
        await tx.payrollRunLine.update({
          where: { id: lineId },
          data: this.toLineRow(runId, companyId, computed, exceptions),
        });
        await this.refreshTotals(tx, runId);
      },
      { timeout: 30_000 },
    );

    return this.getRun(companyId, runId);
  }

  /** Re-pulls master data (salaries, loans, new hires) into an existing draft. */
  async recomputeRun(companyId: string, runId: string) {
    await this.prisma.$transaction(
      async (tx) => {
        const run = await this.getDraftRun(tx, companyId, runId);
        const period = await this.getPeriod(tx, companyId, run.fiscalPeriodId);
        const settings = await this.hrSettingsService.getInTx(tx, companyId);
        const existingLines = await tx.payrollRunLine.findMany({ where: { runId } });
        const exceptionsByEmployee = new Map(
          existingLines.map((l) => [
            l.employeeId,
            {
              unpaidDays: l.unpaidDays,
              absentDays: l.absentDays,
              overtimeHours: l.overtimeHours,
              annualLeaveDaysTaken: l.annualLeaveDaysTaken,
              otherDeduction: l.otherDeduction,
              otherDeductionMemo: l.otherDeductionMemo,
            } satisfies ExceptionInputs,
          ]),
        );

        await tx.payrollRunLine.deleteMany({ where: { runId } });
        const employees = await tx.employee.findMany({
          where: { companyId, status: EmployeeStatus.ACTIVE, joinDate: { lte: period.endDate } },
          orderBy: { code: "asc" },
        });
        for (const employee of employees) {
          const exceptions =
            exceptionsByEmployee.get(employee.id) ??
            (await this.timesheetExceptions(tx, employee.id, period.startDate, period.endDate));
          const computed = await this.computeLine(tx, settings, employee, period.endDate, exceptions);
          await tx.payrollRunLine.create({ data: this.toLineRow(runId, companyId, computed, exceptions) });
        }
        await this.refreshTotals(tx, runId);
      },
      { timeout: 30_000 },
    );

    return this.getRun(companyId, runId);
  }

  async deleteDraft(companyId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, companyId } });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException("Only draft runs can be deleted");
    }
    await this.prisma.payrollRun.delete({ where: { id: runId } });
    return { deleted: true };
  }

  // ── Posting ──────────────────────────────────────────────────────────

  async postRun(companyId: string, runId: string, userId: string, allowSoftClosedOverride = false) {
    const posted = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.getDraftRun(tx, companyId, runId);
        const period = await this.getPeriod(tx, companyId, run.fiscalPeriodId);
        const settings = await this.hrSettingsService.getInTx(tx, companyId);

        // Recompute every line from live master data so a stale draft can
        // never post amounts that no longer match salaries/loans.
        const staleLines = await tx.payrollRunLine.findMany({ where: { runId }, include: { employee: true } });
        const lines: Array<ComputedLine & { exceptions: ExceptionInputs }> = [];
        for (const stale of staleLines) {
          if (stale.employee.status !== EmployeeStatus.ACTIVE) {
            // Terminated since the draft was created — drop from the run
            await tx.payrollRunLine.delete({ where: { id: stale.id } });
            continue;
          }
          const exceptions: ExceptionInputs = {
            unpaidDays: stale.unpaidDays,
            absentDays: stale.absentDays,
            overtimeHours: stale.overtimeHours,
            annualLeaveDaysTaken: stale.annualLeaveDaysTaken,
            otherDeduction: stale.otherDeduction,
            otherDeductionMemo: stale.otherDeductionMemo,
          };
          const computed = await this.computeLine(tx, settings, stale.employee, period.endDate, exceptions);
          lines.push({ ...computed, exceptions });
          await tx.payrollRunLine.update({
            where: { id: stale.id },
            data: this.toLineRow(runId, companyId, computed, exceptions),
          });
        }
        if (lines.length === 0) {
          throw new BadRequestException("Run has no payable lines");
        }

        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const runNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.PAYROLL_RUN,
          fiscalYearId: null,
        });

        const entryLines = await this.composeJournalLines(tx, companyId, lines, runNumber);
        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: period.endDate,
          documentDate: new Date(),
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.PAYROLL,
          sourceDocumentId: runId,
          memo: `Payroll ${runNumber} — period ${period.periodNumber}`,
          allowSoftClosedOverride,
          lines: entryLines,
        });

        // Apply loan deductions exactly as computed
        for (const line of lines) {
          for (const slice of line.loanBreakdown) {
            const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id: slice.loanId } });
            const newBalance = loan.balance.sub(new Prisma.Decimal(slice.amount));
            await tx.employeeLoan.update({
              where: { id: slice.loanId },
              data: {
                balance: newBalance,
                status: newBalance.lte(0) ? LoanStatus.SETTLED : LoanStatus.ACTIVE,
              },
            });
          }
        }

        return tx.payrollRun.update({
          where: { id: runId },
          data: {
            status: PayrollRunStatus.POSTED,
            runNumber,
            runDate: new Date(),
            journalEntryId: entry.id,
            postedByUserId: userId,
            postedAt: new Date(),
            ...this.sumTotals(lines),
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "PayrollRun",
      entityId: runId,
      action: "POST",
      changedByUserId: userId,
      afterSnapshot: posted,
    });

    return this.getRun(companyId, runId);
  }

  async reverseRun(companyId: string, runId: string, userId: string) {
    const reversed = await this.prisma.$transaction(
      async (tx) => {
        const run = await tx.payrollRun.findFirst({
          where: { id: runId, companyId },
          include: { fiscalPeriod: true, lines: true },
        });
        if (!run) {
          throw new NotFoundException("Payroll run not found");
        }
        if (run.status !== PayrollRunStatus.POSTED) {
          throw new ConflictException("Only posted runs can be reversed");
        }

        // EOSB/leave deltas chain across periods — only the latest posted
        // run may be reversed.
        const later = await tx.payrollRun.findFirst({
          where: {
            companyId,
            status: PayrollRunStatus.POSTED,
            fiscalPeriod: { startDate: { gt: run.fiscalPeriod.startDate } },
          },
        });
        if (later) {
          throw new ConflictException("A later posted payroll run exists — reverse that one first");
        }

        // Reversal dated into the period it corrects (as-of-date lesson).
        await this.glPostingService.reverseEntryInTx(tx, companyId, run.journalEntryId!, userId, run.fiscalPeriod.endDate);
        const reversalEntry = await tx.journalEntry.findFirstOrThrow({
          where: { reversalOfEntryId: run.journalEntryId! },
          select: { id: true },
        });

        // Restore each loan balance exactly as it was deducted
        for (const line of run.lines) {
          const breakdown = (line.loanBreakdown as unknown as LoanSlice[] | null) ?? [];
          for (const slice of breakdown) {
            const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id: slice.loanId } });
            await tx.employeeLoan.update({
              where: { id: slice.loanId },
              data: { balance: loan.balance.add(new Prisma.Decimal(slice.amount)), status: LoanStatus.ACTIVE },
            });
          }
        }

        return tx.payrollRun.update({
          where: { id: runId },
          data: { status: PayrollRunStatus.REVERSED, reversalJournalEntryId: reversalEntry.id },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "PayrollRun",
      entityId: runId,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: reversed,
    });

    return this.getRun(companyId, runId);
  }

  // ── Line computation ─────────────────────────────────────────────────

  /**
   * Prior EOSB/leave provision per employee = sum of deltas over POSTED
   * runs. Reversed runs are excluded (their JEs are backed out and only the
   * latest run can be reversed, so sums always mirror the GL).
   */
  private async computeLine(
    tx: TxClient,
    settings: Awaited<ReturnType<HrSettingsService["get"]>>,
    employee: {
      id: string;
      costCenterId: string | null;
      isSaudi: boolean;
      gosiExempt: boolean;
      joinDate: Date;
      basicSalary: Prisma.Decimal;
      housingAllowance: Prisma.Decimal;
      transportAllowance: Prisma.Decimal;
      otherAllowance: Prisma.Decimal;
      annualLeaveDays: Prisma.Decimal;
      leaveOpeningBalance: Prisma.Decimal;
    },
    periodEnd: Date,
    exceptions: ExceptionInputs,
  ): Promise<ComputedLine> {
    const salary = {
      basicSalary: employee.basicSalary,
      housingAllowance: employee.housingAllowance,
      transportAllowance: employee.transportAllowance,
      otherAllowance: employee.otherAllowance,
    };

    // Manpower: labor cost of an assigned employee lands on the rental
    // contract's cost center (assignment covering period end; latest start
    // wins). Falls back to the employee's own cost center.
    const activeAssignment = await tx.manpowerAssignment.findFirst({
      where: {
        employeeId: employee.id,
        isActive: true,
        startDate: { lte: periodEnd },
        OR: [{ endDate: null }, { endDate: { gte: periodEnd } }],
        contract: { status: "ACTIVE" },
      },
      orderBy: { startDate: "desc" },
      include: { contract: { select: { costCenterId: true } } },
    });
    const costCenterId = activeAssignment?.contract.costCenterId ?? employee.costCenterId;

    // Loan installments due this run (oldest loan first)
    const activeLoans = await tx.employeeLoan.findMany({
      where: { employeeId: employee.id, status: LoanStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    });
    const loanBreakdown: LoanSlice[] = [];
    let loanDeduction = ZERO;
    for (const loan of activeLoans) {
      const slice = Prisma.Decimal.min(loan.monthlyInstallment, loan.balance);
      if (slice.gt(0)) {
        loanBreakdown.push({ loanId: loan.id, amount: slice.toString() });
        loanDeduction = loanDeduction.add(slice);
      }
    }

    const computed = computePayrollLine(
      {
        salary,
        isSaudi: employee.isSaudi,
        gosiExempt: employee.gosiExempt,
        unpaidDays: exceptions.unpaidDays,
        absentDays: exceptions.absentDays,
        overtimeHours: exceptions.overtimeHours,
        otherDeduction: exceptions.otherDeduction,
        loanDeduction,
      },
      {
        gosi: {
          saudiEmployeeRatePct: settings.saudiEmployeeRatePct,
          saudiEmployerRatePct: settings.saudiEmployerRatePct,
          expatEmployerRatePct: settings.expatEmployerRatePct,
          gosiWageFloor: settings.gosiWageFloor,
          gosiWageCap: settings.gosiWageCap,
        },
        daysPerMonth: settings.daysPerMonth,
        hoursPerDay: settings.hoursPerDay,
        overtimeMultiplier: settings.overtimeMultiplier,
      },
    );

    // Prior provisions from POSTED run lines (this run's own line is not
    // POSTED yet, so it never contaminates the sum).
    const prior = await tx.payrollRunLine.aggregate({
      where: {
        employeeId: employee.id,
        run: { status: PayrollRunStatus.POSTED },
      },
      _sum: { eosbDelta: true, leaveDelta: true, annualLeaveDaysTaken: true },
    });
    const priorEosb = prior._sum.eosbDelta ?? ZERO;
    const priorLeaveProvision = prior._sum.leaveDelta ?? ZERO;
    const priorLeaveTaken = prior._sum.annualLeaveDaysTaken ?? ZERO;

    const eosbWage = wageForBasis(salary, settings.eosbBasis as EosbBasisKind);
    const years = serviceYears(employee.joinDate, periodEnd);
    const eosbEntitlementToDate = computeEosbEntitlement(eosbWage, years);
    const eosbDelta = eosbEntitlementToDate.sub(priorEosb);

    const accruedDays = employee.leaveOpeningBalance.add(
      computeLeaveAccruedDays(employee.joinDate, periodEnd, employee.annualLeaveDays),
    );
    const leaveBalanceDays = accruedDays.sub(priorLeaveTaken).sub(exceptions.annualLeaveDaysTaken);
    const leaveProvisionToDate = computeLeaveProvision(salary, leaveBalanceDays, settings.daysPerMonth);
    const leaveDelta = leaveProvisionToDate.sub(priorLeaveProvision);

    return {
      employeeId: employee.id,
      costCenterId,
      ...salary,
      gosiBase: computed.gosiBase,
      gosiEmployee: computed.gosiEmployee,
      gosiEmployer: computed.gosiEmployer,
      overtimePay: computed.overtimePay,
      absenceDeduction: computed.absenceDeduction,
      loanDeduction,
      loanBreakdown,
      grossPay: computed.grossPay,
      netPay: computed.netPay,
      eosbEntitlementToDate,
      eosbDelta,
      leaveBalanceDays,
      leaveProvisionToDate,
      leaveDelta,
    };
  }

  // ── Journal composition ──────────────────────────────────────────────

  /**
   * One balanced entry per run. Expense legs (5200/5250/5260/5270) carry the
   * employee's cost-center dimension, aggregated per CC; payable/provision
   * control legs (2310/2320/2520/2340/1160) are undimensioned totals.
   * Negative provision deltas flip a leg's side naturally.
   */
  private async composeJournalLines(
    tx: TxClient,
    companyId: string,
    lines: ComputedLine[],
    runNumber: string,
  ): Promise<PostedEntryLineInput[]> {
    const [salaryExp, gosiExp, eosbExp, leaveExp, gosiPay, salariesPay, loansCtl, eosbProv, leaveProv] =
      await Promise.all([
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.SALARY_EXPENSE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.GOSI_EXPENSE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EOSB_EXPENSE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.LEAVE_EXPENSE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.GOSI_PAYABLE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.SALARIES_PAYABLE),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EMPLOYEE_LOANS),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EOSB_PROVISION),
        this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.LEAVE_PROVISION),
      ]);

    // Signed per-CC sums for the dimensioned expense legs
    const byCC = new Map<string, { gross: Prisma.Decimal; gosi: Prisma.Decimal; eosb: Prisma.Decimal; leave: Prisma.Decimal }>();
    let totalGosiPayable = ZERO;
    let totalLoans = ZERO;
    let totalNet = ZERO;
    let totalEosbDelta = ZERO;
    let totalLeaveDelta = ZERO;

    for (const line of lines) {
      const key = line.costCenterId ?? "";
      const acc = byCC.get(key) ?? { gross: ZERO, gosi: ZERO, eosb: ZERO, leave: ZERO };
      acc.gross = acc.gross.add(line.grossPay);
      acc.gosi = acc.gosi.add(line.gosiEmployer);
      acc.eosb = acc.eosb.add(line.eosbDelta);
      acc.leave = acc.leave.add(line.leaveDelta);
      byCC.set(key, acc);

      totalGosiPayable = totalGosiPayable.add(line.gosiEmployee).add(line.gosiEmployer);
      totalLoans = totalLoans.add(line.loanDeduction);
      totalNet = totalNet.add(line.netPay);
      totalEosbDelta = totalEosbDelta.add(line.eosbDelta);
      totalLeaveDelta = totalLeaveDelta.add(line.leaveDelta);
    }

    const entryLines: PostedEntryLineInput[] = [];
    const pushSigned = (accountId: string, amount: Prisma.Decimal, costCenterId: string | null, description: string) => {
      if (amount.isZero()) return;
      const abs = amount.abs();
      entryLines.push({
        accountId,
        debit: amount.gt(0) ? abs : ZERO,
        credit: amount.gt(0) ? ZERO : abs,
        amountInTransactionCurrency: abs,
        costCenterId,
        description,
      });
    };

    for (const [ccKey, sums] of byCC) {
      const cc = ccKey || null;
      pushSigned(salaryExp.id, sums.gross, cc, `${runNumber} gross salaries`);
      pushSigned(gosiExp.id, sums.gosi, cc, `${runNumber} employer GOSI`);
      pushSigned(eosbExp.id, sums.eosb, cc, `${runNumber} EOSB accrual`);
      pushSigned(leaveExp.id, sums.leave, cc, `${runNumber} leave accrual`);
    }

    // Control legs: negative of the corresponding debit totals
    pushSigned(gosiPay.id, totalGosiPayable.neg(), null, `${runNumber} GOSI payable`);
    pushSigned(loansCtl.id, totalLoans.neg(), null, `${runNumber} loan installments`);
    pushSigned(eosbProv.id, totalEosbDelta.neg(), null, `${runNumber} EOSB provision`);
    pushSigned(leaveProv.id, totalLeaveDelta.neg(), null, `${runNumber} leave provision`);
    pushSigned(salariesPay.id, totalNet.neg(), null, `${runNumber} net salaries payable`);

    return entryLines;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private sumTotals(lines: ComputedLine[]) {
    const sum = (pick: (l: ComputedLine) => Prisma.Decimal) => lines.reduce((acc, l) => acc.add(pick(l)), ZERO);
    return {
      totalGross: sum((l) => l.grossPay),
      totalGosiEmployee: sum((l) => l.gosiEmployee),
      totalGosiEmployer: sum((l) => l.gosiEmployer),
      totalLoanDeductions: sum((l) => l.loanDeduction),
      totalNetPay: sum((l) => l.netPay),
      totalEosbDelta: sum((l) => l.eosbDelta),
      totalLeaveDelta: sum((l) => l.leaveDelta),
    };
  }

  private async refreshTotals(tx: TxClient, runId: string) {
    const agg = await tx.payrollRunLine.aggregate({
      where: { runId },
      _sum: {
        grossPay: true,
        gosiEmployee: true,
        gosiEmployer: true,
        loanDeduction: true,
        netPay: true,
        eosbDelta: true,
        leaveDelta: true,
      },
    });
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        totalGross: agg._sum.grossPay ?? ZERO,
        totalGosiEmployee: agg._sum.gosiEmployee ?? ZERO,
        totalGosiEmployer: agg._sum.gosiEmployer ?? ZERO,
        totalLoanDeductions: agg._sum.loanDeduction ?? ZERO,
        totalNetPay: agg._sum.netPay ?? ZERO,
        totalEosbDelta: agg._sum.eosbDelta ?? ZERO,
        totalLeaveDelta: agg._sum.leaveDelta ?? ZERO,
      },
    });
  }

  private toLineRow(runId: string, companyId: string, line: ComputedLine, exceptions: ExceptionInputs) {
    return {
      runId,
      companyId,
      employeeId: line.employeeId,
      basicSalary: line.basicSalary,
      housingAllowance: line.housingAllowance,
      transportAllowance: line.transportAllowance,
      otherAllowance: line.otherAllowance,
      gosiBase: line.gosiBase,
      gosiEmployee: line.gosiEmployee,
      gosiEmployer: line.gosiEmployer,
      unpaidDays: exceptions.unpaidDays,
      absentDays: exceptions.absentDays,
      overtimeHours: exceptions.overtimeHours,
      annualLeaveDaysTaken: exceptions.annualLeaveDaysTaken,
      otherDeduction: exceptions.otherDeduction,
      otherDeductionMemo: exceptions.otherDeductionMemo,
      overtimePay: line.overtimePay,
      absenceDeduction: line.absenceDeduction,
      loanDeduction: line.loanDeduction,
      loanBreakdown: line.loanBreakdown as unknown as Prisma.InputJsonValue,
      grossPay: line.grossPay,
      netPay: line.netPay,
      eosbEntitlementToDate: line.eosbEntitlementToDate,
      eosbDelta: line.eosbDelta,
      leaveBalanceDays: line.leaveBalanceDays,
      leaveProvisionToDate: line.leaveProvisionToDate,
      leaveDelta: line.leaveDelta,
      costCenterId: line.costCenterId,
    };
  }

  /**
   * Default payroll exceptions from APPROVED/INVOICED manpower timesheet
   * entries in the period: day-type counts and OT hours across all of the
   * employee's assignments. DRAFT timesheets are ignored (not yet reviewed).
   */
  private async timesheetExceptions(
    tx: TxClient,
    employeeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ExceptionInputs> {
    const entries = await tx.timesheetEntry.findMany({
      where: {
        employeeId,
        date: { gte: periodStart, lte: periodEnd },
        timesheet: { status: { in: ["APPROVED", "INVOICED"] } },
      },
      select: { dayType: true, overtimeHours: true },
    });
    let absentDays = ZERO;
    let unpaidDays = ZERO;
    let annualLeaveDaysTaken = ZERO;
    let overtimeHours = ZERO;
    const ONE = new Prisma.Decimal(1);
    for (const entry of entries) {
      if (entry.dayType === "ABSENT") absentDays = absentDays.add(ONE);
      else if (entry.dayType === "UNPAID_LEAVE") unpaidDays = unpaidDays.add(ONE);
      else if (entry.dayType === "ANNUAL_LEAVE") annualLeaveDaysTaken = annualLeaveDaysTaken.add(ONE);
      if (entry.dayType === "WORKED") overtimeHours = overtimeHours.add(entry.overtimeHours);
    }
    return {
      unpaidDays,
      absentDays,
      overtimeHours,
      annualLeaveDaysTaken,
      otherDeduction: ZERO,
      otherDeductionMemo: null,
    };
  }

  private async getDraftRun(tx: TxClient, companyId: string, runId: string) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId } });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException(`Run is ${run.status} — only drafts can be modified`);
    }
    return run;
  }

  private async getPeriod(tx: TxClient, companyId: string, fiscalPeriodId: string) {
    const period = await tx.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException("Fiscal period is closed");
    }
    return period;
  }
}
