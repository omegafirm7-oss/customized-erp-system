import { Injectable, NotFoundException } from "@nestjs/common";
import { EmployeePaymentCategory, EmployeeStatus, PayrollRunStatus, Prisma, TimesheetDayType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { HrSettingsService } from "./hr-settings.service";
import {
  computeEosbEntitlement,
  computeLeaveAccruedDays,
  computeLeaveProvision,
  serviceYears,
  wageForBasis,
  EosbBasisKind,
} from "./payroll-math";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class HrReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hrSettingsService: HrSettingsService,
  ) {}

  /** GOSI filing summary for a period's posted run — mirrors the GOSI portal upload. */
  async gosiSummary(companyId: string, fiscalPeriodId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { companyId, fiscalPeriodId, status: PayrollRunStatus.POSTED },
      include: {
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        lines: {
          orderBy: { employee: { code: "asc" } },
          include: { employee: { select: { code: true, nameEn: true, isSaudi: true, gosiNumber: true } } },
        },
      },
    });
    if (!run) {
      throw new NotFoundException("No posted payroll run for this period");
    }
    const rows = run.lines.map((line) => ({
      employeeCode: line.employee.code,
      nameEn: line.employee.nameEn,
      isSaudi: line.employee.isSaudi,
      gosiNumber: line.employee.gosiNumber,
      gosiBase: line.gosiBase,
      employeeShare: line.gosiEmployee,
      employerShare: line.gosiEmployer,
      total: line.gosiEmployee.add(line.gosiEmployer),
    }));
    return {
      runNumber: run.runNumber,
      period: run.fiscalPeriod,
      rows,
      totals: {
        employeeShare: run.totalGosiEmployee,
        employerShare: run.totalGosiEmployer,
        total: run.totalGosiEmployee.add(run.totalGosiEmployer),
      },
    };
  }

  /** EOSB liability per active employee: entitlement to date vs provision booked. */
  async eosbLiability(companyId: string) {
    const settings = await this.hrSettingsService.get(companyId);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.ACTIVE },
      orderBy: { code: "asc" },
    });
    const now = new Date();
    const rows = [];
    for (const employee of employees) {
      const prior = await this.prisma.payrollRunLine.aggregate({
        where: { employeeId: employee.id, run: { status: PayrollRunStatus.POSTED } },
        _sum: { eosbDelta: true },
      });
      const salary = {
        basicSalary: employee.basicSalary,
        housingAllowance: employee.housingAllowance,
        transportAllowance: employee.transportAllowance,
        otherAllowance: employee.otherAllowance,
      };
      const years = serviceYears(employee.joinDate, now);
      rows.push({
        employeeId: employee.id,
        code: employee.code,
        nameEn: employee.nameEn,
        joinDate: employee.joinDate,
        serviceYears: years.toDecimalPlaces(2),
        eosbWage: wageForBasis(salary, settings.eosbBasis as EosbBasisKind),
        entitlementToDate: computeEosbEntitlement(wageForBasis(salary, settings.eosbBasis as EosbBasisKind), years),
        provisionBooked: prior._sum.eosbDelta ?? ZERO,
      });
    }
    return rows;
  }

  /** Leave balances and provision per active employee. */
  async leaveBalances(companyId: string) {
    const settings = await this.hrSettingsService.get(companyId);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.ACTIVE },
      orderBy: { code: "asc" },
    });
    const now = new Date();
    const rows = [];
    for (const employee of employees) {
      const prior = await this.prisma.payrollRunLine.aggregate({
        where: { employeeId: employee.id, run: { status: PayrollRunStatus.POSTED } },
        _sum: { annualLeaveDaysTaken: true, leaveDelta: true },
      });
      const salary = {
        basicSalary: employee.basicSalary,
        housingAllowance: employee.housingAllowance,
        transportAllowance: employee.transportAllowance,
        otherAllowance: employee.otherAllowance,
      };
      const accrued = employee.leaveOpeningBalance.add(
        computeLeaveAccruedDays(employee.joinDate, now, employee.annualLeaveDays),
      );
      const taken = prior._sum.annualLeaveDaysTaken ?? ZERO;
      const balance = accrued.sub(taken).toDecimalPlaces(2);
      rows.push({
        employeeId: employee.id,
        code: employee.code,
        nameEn: employee.nameEn,
        annualLeaveDays: employee.annualLeaveDays,
        accruedDays: accrued.toDecimalPlaces(2),
        takenDays: taken,
        balanceDays: balance,
        provisionValue: computeLeaveProvision(salary, balance, settings.daysPerMonth),
        provisionBooked: prior._sum.leaveDelta ?? ZERO,
      });
    }
    return rows;
  }

  /** Payroll register CSV export for a run. */
  async registerCsv(companyId: string, runId: string): Promise<{ filename: string; content: string }> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        lines: {
          orderBy: { employee: { code: "asc" } },
          include: { employee: { select: { code: true, nameEn: true } }, costCenter: { select: { code: true } } },
        },
      },
    });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    const header = [
      "employee",
      "name",
      "costCenter",
      "basic",
      "housing",
      "transport",
      "other",
      "overtimePay",
      "absenceDeduction",
      "grossPay",
      "gosiEmployee",
      "gosiEmployer",
      "loanDeduction",
      "otherDeduction",
      "netPay",
      "eosbDelta",
      "leaveDelta",
    ];
    const rows = run.lines.map((l) =>
      [
        l.employee.code,
        l.employee.nameEn.replace(/,/g, " "),
        l.costCenter?.code ?? "",
        l.basicSalary.toFixed(2),
        l.housingAllowance.toFixed(2),
        l.transportAllowance.toFixed(2),
        l.otherAllowance.toFixed(2),
        l.overtimePay.toFixed(2),
        l.absenceDeduction.toFixed(2),
        l.grossPay.toFixed(2),
        l.gosiEmployee.toFixed(2),
        l.gosiEmployer.toFixed(2),
        l.loanDeduction.toFixed(2),
        l.otherDeduction.toFixed(2),
        l.netPay.toFixed(2),
        l.eosbDelta.toFixed(2),
        l.leaveDelta.toFixed(2),
      ].join(","),
    );
    return {
      filename: `payroll_register_${run.runNumber ?? run.id}.csv`,
      content: [header.join(","), ...rows].join("\r\n") + "\r\n",
    };
  }

  /** Resolves a fiscal period's date range, or null for "overall" (all-time, unbounded). */
  private async resolveDateRange(companyId: string, fiscalPeriodId?: string): Promise<{ start: Date; end: Date } | null> {
    if (!fiscalPeriodId) {
      return null;
    }
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    return { start: period.startDate, end: period.endDate };
  }

  /**
   * KPI dashboard for the Employees Overview page: active/released counts,
   * total paid and pending, a per-day labor cost series driven by real
   * timesheets, and the per-project cost table. When `fiscalPeriodId` is
   * omitted, every figure is computed "overall" (all-time, unbounded) —
   * the default view; passing a period scopes totalPaid/dailyLaborCost/
   * groups to that period (activeCount/releasedCount/totalPending are
   * always company-wide regardless, since headcount and outstanding
   * balances carry forward rather than resetting each period).
   * hourlyRate = basicSalary / 26 / 10 (26 working days/month, Friday
   * excluded, 10-hour standard day — a fixed construction-costing
   * convention, intentionally NOT HrSettings.daysPerMonth, which drives
   * statutory payroll math with a different meaning).
   */
  async employeesDashboard(companyId: string, fiscalPeriodId?: string) {
    const HOURLY_DIVISOR = new Prisma.Decimal(260); // 26 days × 10 hours/day
    const range = await this.resolveDateRange(companyId, fiscalPeriodId);
    const dateFilter = range ? { gte: range.start, lte: range.end } : undefined;

    const [activeEmployees, releasedCount] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, status: EmployeeStatus.ACTIVE },
        orderBy: { code: "asc" },
        include: {
          costCenter: {
            include: {
              project: { select: { code: true, name: true } },
              manpowerContract: { select: { code: true, name: true } },
              equipmentRentalContract: { select: { code: true, name: true } },
            },
          },
          employeeTimesheetEntries: {
            where: dateFilter ? { date: dateFilter } : undefined,
            select: { date: true, hoursWorked: true },
          },
        },
      }),
      this.prisma.employee.count({ where: { companyId, status: EmployeeStatus.TERMINATED } }),
    ]);

    const groups = new Map<
      string,
      { key: string; label: string; rows: Array<Record<string, unknown>>; subtotal: Prisma.Decimal }
    >();
    const dailyCostByDate = new Map<string, Prisma.Decimal>();
    let grandTotal = ZERO;

    for (const employee of activeEmployees) {
      const hourlyRate = employee.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
      let employeeHours = ZERO;
      let employeeCost = ZERO;
      for (const entry of employee.employeeTimesheetEntries) {
        const cost = hourlyRate.mul(entry.hoursWorked).toDecimalPlaces(2);
        employeeHours = employeeHours.add(entry.hoursWorked);
        employeeCost = employeeCost.add(cost);
        const dateKey = entry.date.toISOString().slice(0, 10);
        dailyCostByDate.set(dateKey, (dailyCostByDate.get(dateKey) ?? ZERO).add(cost));
      }

      const cc = employee.costCenter;
      const groupKey = cc?.id ?? "unassigned";
      const groupLabel = cc
        ? (cc.project?.name ?? cc.manpowerContract?.name ?? cc.equipmentRentalContract?.name ?? cc.name) +
          ` (${cc.code})`
        : "Unassigned";

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { key: groupKey, label: groupLabel, rows: [], subtotal: ZERO });
      }
      const group = groups.get(groupKey)!;
      group.rows.push({
        employeeId: employee.id,
        code: employee.code,
        nameEn: employee.nameEn,
        designation: employee.designation,
        basicSalary: employee.basicSalary,
        hourlyRate,
        hoursWorked: employeeHours,
        cost: employeeCost,
      });
      group.subtotal = group.subtotal.add(employeeCost);
      grandTotal = grandTotal.add(employeeCost);
    }

    const dailyLaborCost = [...dailyCostByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));

    // Released employees, treated exactly like active ones for cost
    // purposes: accrued cost from their own logged timesheet hours, offset
    // by whatever SALARY/FOOD payments they were actually paid. A final
    // settlement (EOSB, leave payout, loan recovery, the lump-sum on
    // termination/resignation) is a one-time HR/legal payout, not ongoing
    // project labor cost — deliberately excluded here (still fully visible
    // on the Released Employees detail page, just not folded into this
    // labor-cost KPI or into Project Intelligence).
    const releasedEmployeesRaw = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.TERMINATED },
      select: {
        id: true,
        code: true,
        nameEn: true,
        designation: true,
        basicSalary: true,
        employeeTimesheetEntries: {
          where: dateFilter ? { date: dateFilter } : undefined,
          select: { hoursWorked: true },
        },
        payments: {
          where: {
            reversedAt: null,
            category: { in: [EmployeePaymentCategory.SALARY, EmployeePaymentCategory.FOOD] },
            ...(dateFilter ? { paymentDate: dateFilter } : {}),
          },
          select: { category: true, amount: true },
        },
      },
    });

    let releasedGrandTotal = ZERO;
    let releasedPaidSalary = ZERO;
    let releasedPaidFood = ZERO;
    const releasedTradeRows: Array<{ employeeId: string; code: string; nameEn: string; designation: string | null; cost: Prisma.Decimal }> =
      [];
    for (const e of releasedEmployeesRaw) {
      const hourlyRate = e.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
      const cost = e.employeeTimesheetEntries.reduce((sum, t) => sum.add(hourlyRate.mul(t.hoursWorked).toDecimalPlaces(2)), ZERO);
      releasedGrandTotal = releasedGrandTotal.add(cost);
      releasedPaidSalary = releasedPaidSalary.add(
        e.payments.filter((p) => p.category === EmployeePaymentCategory.SALARY).reduce((sum, p) => sum.add(p.amount), ZERO),
      );
      releasedPaidFood = releasedPaidFood.add(
        e.payments.filter((p) => p.category === EmployeePaymentCategory.FOOD).reduce((sum, p) => sum.add(p.amount), ZERO),
      );
      releasedTradeRows.push({ employeeId: e.id, code: e.code, nameEn: e.nameEn, designation: e.designation, cost });
    }
    const releasedPendingLaborAccrual = Prisma.Decimal.max(ZERO, releasedGrandTotal.sub(releasedPaidSalary));

    const [payrollNetPay, paymentsByCategory, pendingPayments] = await Promise.all([
      fiscalPeriodId
        ? this.prisma.payrollRun
            .findFirst({ where: { companyId, fiscalPeriodId, status: PayrollRunStatus.POSTED } })
            .then((run) => run?.totalNetPay ?? ZERO)
        : this.prisma.payrollRun
            .aggregate({ where: { companyId, status: PayrollRunStatus.POSTED }, _sum: { totalNetPay: true } })
            .then((r) => r._sum.totalNetPay ?? ZERO),
      // Per-category split — same breakdown as employees.service.ts
      // getSummary() (paidSalary/paidAllowance/paidFood/paidAdvance), just
      // aggregated across active employees instead of per-employee, so
      // "Total Paid" on the Overview reads the same way as an individual
      // employee's card. Scoped to ACTIVE only (via the employee relation)
      // so it doesn't double-count released employees' salary/food, which
      // are already folded into releasedPaidSalary/releasedPaidFood above.
      this.prisma.employeePayment.groupBy({
        by: ["category"],
        where: {
          companyId,
          reversedAt: null,
          employee: { status: EmployeeStatus.ACTIVE },
          ...(dateFilter ? { paymentDate: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.employeePayment.findMany({
        where: {
          companyId,
          reversedAt: null,
          category: { in: [EmployeePaymentCategory.ADVANCE, EmployeePaymentCategory.OTHER] },
        },
        select: { amount: true, recoveredAmount: true },
      }),
    ]);

    const sumForCategory = (category: EmployeePaymentCategory) =>
      paymentsByCategory.find((p) => p.category === category)?._sum.amount ?? ZERO;
    // SALARY-category payments pay down pending labor accrual directly, the
    // same way a posted payroll run's net pay does — scoped to the same
    // period as payrollNetPay/grandTotal above via dateFilter. This
    // company-wide split (active + released combined) still includes the
    // released employees' own SALARY/FOOD payments computed above.
    const directSalaryPayments = sumForCategory(EmployeePaymentCategory.SALARY);
    const paidSalary = payrollNetPay.add(directSalaryPayments);
    const paidAllowance = sumForCategory(EmployeePaymentCategory.ALLOWANCE);
    const paidFood = sumForCategory(EmployeePaymentCategory.FOOD);
    const paidAdvance = sumForCategory(EmployeePaymentCategory.ADVANCE).add(sumForCategory(EmployeePaymentCategory.OTHER));

    // Wages accrued via logged hours that haven't been covered by a posted
    // payroll run (or a direct SALARY cash payment) yet — the company's
    // actual current state is "hours logged, nothing paid", so until either
    // catches up, the full accrued cost is genuinely owed. Floored at zero
    // so coverage that already meets/exceeds the accrued cost never shows a
    // negative "pending" amount.
    const pendingLaborAccrual = Prisma.Decimal.max(ZERO, grandTotal.sub(payrollNetPay).sub(directSalaryPayments));

    const totalPaidActive = paidSalary.add(paidAllowance).add(paidFood).add(paidAdvance);
    const totalPaidReleased = releasedPaidSalary.add(releasedPaidFood);
    const totalPaid = totalPaidActive.add(totalPaidReleased);

    const totalPendingAdvances = pendingPayments.reduce((sum, p) => sum.add(p.amount.sub(p.recoveredAmount)), ZERO);
    const totalPendingActive = totalPendingAdvances.add(pendingLaborAccrual);
    const totalPendingReleased = releasedPendingLaborAccrual;
    const totalPending = totalPendingActive.add(totalPendingReleased);

    const releasedEmployees = await this.releasedEmployeesList(companyId);

    return {
      scope: fiscalPeriodId ? ("period" as const) : ("overall" as const),
      fiscalPeriodId: fiscalPeriodId ?? null,
      activeCount: activeEmployees.length,
      releasedCount,
      totalPaid,
      totalPaidActive,
      totalPaidReleased,
      paidSalary,
      paidAllowance,
      paidFood,
      paidAdvance,
      totalPending,
      totalPendingActive,
      totalPendingReleased,
      totalPendingAdvances,
      pendingLaborAccrual,
      dailyLaborCost,
      groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)),
      grandTotal,
      releasedGrandTotal,
      releasedTradeRows,
      releasedEmployees,
    };
  }

  /**
   * Drill-down for the "Active Employees" KPI tile — per-employee timesheet
   * + allowance/advance detail. Overall (all-time) by default; pass
   * `fiscalPeriodId` to scope hours/cost/timesheetEntries to one period
   * (allowancesPaid/pendingAdvances stay company-wide either way, same
   * carry-forward reasoning as employeesDashboard).
   */
  async activeEmployeesDetail(companyId: string, fiscalPeriodId?: string) {
    const HOURLY_DIVISOR = new Prisma.Decimal(260);
    const range = await this.resolveDateRange(companyId, fiscalPeriodId);
    const dateFilter = range ? { gte: range.start, lte: range.end } : undefined;

    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.ACTIVE },
      orderBy: { code: "asc" },
      include: {
        costCenter: { select: { code: true, name: true } },
        employeeTimesheetEntries: {
          where: dateFilter ? { date: dateFilter } : undefined,
          orderBy: { date: "asc" },
        },
        payments: { where: { reversedAt: null }, select: { category: true, amount: true, recoveredAmount: true } },
      },
    });

    return employees.map((employee) => {
      const hourlyRate = employee.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
      const daysWorked = employee.employeeTimesheetEntries.filter((t) => t.dayType === TimesheetDayType.WORKED).length;
      const totalHours = employee.employeeTimesheetEntries.reduce((sum, t) => sum.add(t.hoursWorked), ZERO);
      // Sum of per-day rounded costs, matching employeesDashboard's
      // dailyLaborCost math exactly — rounding totalHours × hourlyRate once
      // instead would drift a few cents from the dashboard for the same
      // employee/period.
      const cost = employee.employeeTimesheetEntries.reduce(
        (sum, t) => sum.add(hourlyRate.mul(t.hoursWorked).toDecimalPlaces(2)),
        ZERO,
      );
      const allowancesPaid = employee.payments
        .filter((p) => p.category === EmployeePaymentCategory.ALLOWANCE)
        .reduce((sum, p) => sum.add(p.amount), ZERO);
      const pendingAdvances = employee.payments
        .filter((p) => p.category === EmployeePaymentCategory.ADVANCE || p.category === EmployeePaymentCategory.OTHER)
        .reduce((sum, p) => sum.add(p.amount.sub(p.recoveredAmount)), ZERO);
      return {
        employeeId: employee.id,
        code: employee.code,
        nameEn: employee.nameEn,
        designation: employee.designation,
        costCenter: employee.costCenter,
        basicSalary: employee.basicSalary,
        hourlyRate,
        daysWorked,
        totalHours,
        cost,
        allowancesPaid,
        pendingAdvances,
        timesheetEntries: employee.employeeTimesheetEntries.map((t) => ({
          date: t.date,
          dayType: t.dayType,
          hoursWorked: t.hoursWorked,
        })),
      };
    });
  }

  private async releasedEmployeesList(companyId: string) {
    const released = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.TERMINATED },
      orderBy: { terminationDate: "desc" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        designation: true,
        terminationDate: true,
        finalSettlement: {
          select: { settlementNumber: true, reason: true, netAmount: true, paidAmount: true, status: true },
        },
      },
    });
    return released.map((e) => ({
      employeeId: e.id,
      code: e.code,
      nameEn: e.nameEn,
      designation: e.designation,
      terminationDate: e.terminationDate,
      settlementNumber: e.finalSettlement?.settlementNumber ?? null,
      reason: e.finalSettlement?.reason ?? null,
      netAmount: e.finalSettlement?.netAmount ?? null,
      paidAmount: e.finalSettlement?.paidAmount ?? null,
      pendingAmount: e.finalSettlement ? e.finalSettlement.netAmount.sub(e.finalSettlement.paidAmount) : null,
      settlementStatus: e.finalSettlement?.status ?? null,
    }));
  }
}
