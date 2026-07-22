import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  EmployeePaymentCategory,
  EmployeeStatus,
  LoanStatus,
  PayrollRunStatus,
  Prisma,
  SettlementStatus,
  TimesheetDayType,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { HrSettingsService } from "./hr-settings.service";
import { CreateEmployeeDto, UpdateEmployeeDto } from "./dto/hr.dtos";

/**
 * Column order of the CSV import template. Kept flat and WPS-shaped on
 * purpose (basic/housing/transport/other split maps 1:1 to the SIF file).
 */
const CSV_COLUMNS = [
  "code",
  "nameEn",
  "nameAr",
  "designation",
  "nationality",
  "isSaudi",
  "iqamaOrNationalId",
  "iqamaExpiry",
  "passportNumber",
  "passportExpiry",
  "gosiNumber",
  "joinDate",
  "contractType",
  "bankCode",
  "iban",
  "costCenterCode",
  "annualLeaveDays",
  "basicSalary",
  "housingAllowance",
  "transportAllowance",
  "otherAllowance",
  "gosiExempt",
] as const;

const CSV_SAMPLE_ROWS = [
  // Saudi national — both GOSI shares apply
  "EMP-001,Ahmed Al-Saud,أحمد آل سعود,Site Supervisor,SA,true,1012345678,2027-06-30,,,50012345,2024-02-01,UNLIMITED,80,SA4420000001234567891234,,21,10000,2500,1000,0,false",
  // Expat — employer-only GOSI at the expat rate
  "EMP-002,John Perera,,Mason,LK,false,2298765432,2026-11-15,N1234567,2028-03-01,,2025-07-01,LIMITED,10,SA0380000000608010167519,,21,8000,2000,0,0,false",
];

export interface ImportRowError {
  row: number;
  message: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly hrSettingsService: HrSettingsService,
  ) {}

  async list(companyId: string, status?: EmployeeStatus) {
    const ZERO = new Prisma.Decimal(0);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { code: "asc" },
      include: {
        costCenter: { select: { code: true, name: true } },
        loans: { where: { status: "ACTIVE" }, select: { id: true, loanNumber: true, balance: true } },
        payments: {
          where: { category: { not: EmployeePaymentCategory.ALLOWANCE } },
          select: { amount: true, recoveredAmount: true },
        },
        finalSettlement: { select: { netAmount: true, paidAmount: true, status: true } },
      },
    });
    // "Pending" here mirrors getSummary(): active loan balances + unrecovered
    // advances + a still-POSTED settlement's unpaid balance. Shown for every
    // employee, released or not — a REVERSED settlement never contributes.
    return employees.map(({ payments, ...e }) => {
      const loanBalance = e.loans.reduce((sum, l) => sum.add(l.balance), ZERO);
      const pendingAdvances = payments.reduce((sum, p) => sum.add(p.amount.sub(p.recoveredAmount)), ZERO);
      const settlementPending =
        e.finalSettlement && e.finalSettlement.status === SettlementStatus.POSTED
          ? e.finalSettlement.netAmount.sub(e.finalSettlement.paidAmount)
          : ZERO;
      return { ...e, pendingAmount: loanBalance.add(pendingAdvances).add(settlementPending) };
    });
  }

  async get(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        costCenter: { select: { id: true, code: true, name: true } },
        loans: { orderBy: { createdAt: "desc" } },
        finalSettlement: { include: { payments: { orderBy: { paymentDate: "desc" } } } },
      },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  async create(companyId: string, userId: string, dto: CreateEmployeeDto) {
    const employee = await this.prisma.$transaction(async (tx) => this.createInTx(tx, companyId, userId, dto));
    await this.auditService.log({
      companyId,
      entityName: "Employee",
      entityId: employee.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: employee,
    });
    return employee;
  }

  async update(companyId: string, employeeId: string, userId: string, dto: UpdateEmployeeDto) {
    const before = await this.get(companyId, employeeId);
    if (before.status === EmployeeStatus.TERMINATED) {
      throw new ConflictException("Terminated employees cannot be edited");
    }
    if (dto.code && dto.code !== before.code) {
      const clash = await this.prisma.employee.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (clash) {
        throw new ConflictException(`Employee code ${dto.code} already exists`);
      }
    }
    if (dto.costCenterId) {
      await this.assertCostCenter(this.prisma, companyId, dto.costCenterId);
    }

    const dec = (v?: string) => (v !== undefined ? new Prisma.Decimal(v) : undefined);
    const date = (v?: string) => (v !== undefined ? (v ? new Date(v) : null) : undefined);
    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        designation: dto.designation,
        nationality: dto.nationality,
        isSaudi: dto.isSaudi,
        gender: dto.gender,
        dateOfBirth: date(dto.dateOfBirth),
        iqamaOrNationalId: dto.iqamaOrNationalId,
        iqamaExpiry: date(dto.iqamaExpiry),
        passportNumber: dto.passportNumber,
        passportExpiry: date(dto.passportExpiry),
        gosiNumber: dto.gosiNumber,
        joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined,
        contractType: dto.contractType,
        bankCode: dto.bankCode,
        iban: dto.iban,
        costCenterId: dto.costCenterId,
        annualLeaveDays: dec(dto.annualLeaveDays),
        leaveOpeningBalance: dec(dto.leaveOpeningBalance),
        basicSalary: dec(dto.basicSalary),
        housingAllowance: dec(dto.housingAllowance),
        transportAllowance: dec(dto.transportAllowance),
        otherAllowance: dec(dto.otherAllowance),
        gosiExempt: dto.gosiExempt,
        updatedByUserId: userId,
      },
      include: { costCenter: { select: { code: true, name: true } } },
    });

    // Salary changes feed payroll, GOSI and EOSB — audit with before/after.
    await this.auditService.log({
      companyId,
      entityName: "Employee",
      entityId: employeeId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });

    return updated;
  }

  /**
   * Hard-delete only when the employee has zero transactional history —
   * this is the correction path for a mistaken entry, not a way to remove
   * someone with real payroll/payment history (that must go through
   * Release, which preserves the audit trail). EmployeeTimesheetEntry rows
   * cascade automatically (disposable costing metadata, not financial).
   */
  async delete(companyId: string, employeeId: string, userId: string) {
    const employee = await this.get(companyId, employeeId);
    const [loans, payrollLines, assignments, timesheetEntries, payments] = await Promise.all([
      this.prisma.employeeLoan.count({ where: { employeeId } }),
      this.prisma.payrollRunLine.count({ where: { employeeId } }),
      this.prisma.manpowerAssignment.count({ where: { employeeId } }),
      this.prisma.timesheetEntry.count({ where: { employeeId } }),
      this.prisma.employeePayment.count({ where: { employeeId } }),
    ]);
    if (loans + payrollLines + assignments + timesheetEntries + payments > 0 || employee.finalSettlement) {
      throw new ConflictException(
        "Employee has payroll, loan, assignment, attendance, or settlement history — release them instead of deleting",
      );
    }

    await this.prisma.employee.delete({ where: { id: employeeId } });

    await this.auditService.log({
      companyId,
      entityName: "Employee",
      entityId: employeeId,
      action: "DELETE",
      changedByUserId: userId,
      beforeSnapshot: employee,
    });

    return { deleted: true };
  }

  /**
   * Per-employee financial + attendance summary for the Employee Detail
   * page. Paid splits into salary (posted payroll net pay) / advance /
   * allowance; pending splits into salary (accrued-but-unpaid labor cost +
   * unpaid settlement, if released) / allowance-advance (unrecovered
   * advances) — same category split as the company-wide Overview dashboard
   * (see hr-reports.service.ts employeesDashboard), just scoped to one
   * employee. Loans remain their own separate figure (the formal,
   * installment-deducted path, distinct from informal EmployeePayment
   * advances).
   */
  async getSummary(companyId: string, employeeId: string) {
    const ZERO = new Prisma.Decimal(0);
    const HOURLY_DIVISOR = new Prisma.Decimal(260); // 26 days x 10 hours/day — matches hr-reports.service.ts employeesDashboard
    const employee = await this.get(companyId, employeeId);

    const [payments, timesheetAgg, actualWorkedDays, paidSalaryAgg] = await Promise.all([
      this.prisma.employeePayment.findMany({
        where: { employeeId },
        select: { category: true, amount: true, recoveredAmount: true },
      }),
      this.prisma.employeeTimesheetEntry.groupBy({
        by: ["dayType"],
        where: { employeeId },
        _sum: { hoursWorked: true },
        _count: { _all: true },
      }),
      // Bulk prefill creates a WORKED/0h placeholder for every calendar day
      // of a period, even ones the user never touches — counting those in
      // "days worked" would inflate it far past reality (e.g. 200+ days for
      // someone who really worked ~40). Only entries with real hours count.
      this.prisma.employeeTimesheetEntry.count({
        where: { employeeId, dayType: TimesheetDayType.WORKED, hoursWorked: { gt: 0 } },
      }),
      this.prisma.payrollRunLine.aggregate({
        where: { employeeId, run: { status: PayrollRunStatus.POSTED } },
        _sum: { netPay: true },
      }),
    ]);

    const paidAdvance = payments
      .filter((p) => p.category !== EmployeePaymentCategory.ALLOWANCE)
      .reduce((sum, p) => sum.add(p.amount), ZERO);
    const paidAllowance = payments
      .filter((p) => p.category === EmployeePaymentCategory.ALLOWANCE)
      .reduce((sum, p) => sum.add(p.amount), ZERO);
    const paidSalary = paidSalaryAgg._sum.netPay ?? ZERO;
    const totalPaid = paidSalary.add(paidAdvance).add(paidAllowance);

    const pendingAllowance = payments
      .filter((p) => p.category !== EmployeePaymentCategory.ALLOWANCE)
      .reduce((sum, p) => sum.add(p.amount.sub(p.recoveredAmount)), ZERO);
    const loanBalance = employee.loans
      .filter((l) => l.status === LoanStatus.ACTIVE)
      .reduce((sum, l) => sum.add(l.balance), ZERO);
    // A REVERSED settlement carries no real debt — only a POSTED one is
    // actually owed. Without this check, an employee released, then
    // reversed, would show a phantom "pending settlement" forever.
    const settlementPending =
      employee.finalSettlement && employee.finalSettlement.status === SettlementStatus.POSTED
        ? employee.finalSettlement.netAmount.sub(employee.finalSettlement.paidAmount)
        : ZERO;

    const workedAgg = timesheetAgg.find((t) => t.dayType === TimesheetDayType.WORKED);
    const absentAgg = timesheetAgg.find((t) => t.dayType === TimesheetDayType.ABSENT);
    const unpaidLeaveAgg = timesheetAgg.find((t) => t.dayType === TimesheetDayType.UNPAID_LEAVE);
    const workedHours = workedAgg?._sum.hoursWorked ?? ZERO;
    const hourlyRate = employee.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
    const accruedLaborCost = hourlyRate.mul(workedHours).toDecimalPlaces(2);
    // Wages accrued via logged hours that haven't been covered by a posted
    // payroll run yet — floored at zero so a payroll run that already
    // covers (or exceeds) the accrued cost never shows negative "pending".
    const pendingLaborAccrual = Prisma.Decimal.max(ZERO, accruedLaborCost.sub(paidSalary));
    const pendingSalary = pendingLaborAccrual.add(settlementPending);

    const totalPending = pendingSalary.add(pendingAllowance).add(loanBalance);

    return {
      paidSalary,
      paidAdvance,
      paidAllowance,
      totalPaid,
      pendingSalary,
      pendingAllowance,
      pendingLaborAccrual,
      loanBalance,
      settlementPending,
      totalPending,
      workedDays: actualWorkedDays,
      workedHours,
      absentDays: absentAgg?._count._all ?? 0,
      unpaidLeaveDays: unpaidLeaveAgg?._count._all ?? 0,
    };
  }

  /** Iqama/passport documents expiring within the window (default 90 days). */
  async expiringDocuments(companyId: string, withinDays = 90) {
    const until = new Date(Date.now() + withinDays * 24 * 3600 * 1000);
    return this.prisma.employee.findMany({
      where: {
        companyId,
        status: EmployeeStatus.ACTIVE,
        OR: [{ iqamaExpiry: { lte: until } }, { passportExpiry: { lte: until } }],
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        iqamaOrNationalId: true,
        iqamaExpiry: true,
        passportNumber: true,
        passportExpiry: true,
      },
      orderBy: { iqamaExpiry: "asc" },
    });
  }

  // ── CSV import ───────────────────────────────────────────────────────

  csvTemplate(): string {
    return [CSV_COLUMNS.join(","), ...CSV_SAMPLE_ROWS].join("\r\n") + "\r\n";
  }

  /**
   * All-or-nothing import: every row is validated and inserted in one
   * transaction; any error report aborts the whole file so a partial load
   * never needs manual cleanup.
   */
  async importCsv(companyId: string, userId: string, csv: string) {
    const settings = await this.hrSettingsService.get(companyId);
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException("CSV must contain a header row and at least one data row");
    }

    const header = lines[0].split(",").map((h) => h.trim());
    if (header.join(",") !== CSV_COLUMNS.join(",")) {
      throw new BadRequestException(
        `CSV header does not match the template. Expected: ${CSV_COLUMNS.join(",")}`,
      );
    }

    const errors: ImportRowError[] = [];
    const rows: Array<Record<(typeof CSV_COLUMNS)[number], string>> = [];
    const seenCodes = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim());
      if (cells.length !== CSV_COLUMNS.length) {
        errors.push({ row: i + 1, message: `Expected ${CSV_COLUMNS.length} columns, got ${cells.length}` });
        continue;
      }
      const row = Object.fromEntries(CSV_COLUMNS.map((col, idx) => [col, cells[idx]])) as Record<
        (typeof CSV_COLUMNS)[number],
        string
      >;
      if (!row.code) errors.push({ row: i + 1, message: "code is required" });
      if (!row.nameEn) errors.push({ row: i + 1, message: "nameEn is required" });
      if (!row.joinDate || isNaN(Date.parse(row.joinDate)))
        errors.push({ row: i + 1, message: "joinDate must be a valid date (YYYY-MM-DD)" });
      if (row.contractType && !["UNLIMITED", "LIMITED"].includes(row.contractType))
        errors.push({ row: i + 1, message: "contractType must be UNLIMITED or LIMITED" });
      for (const flag of ["isSaudi", "gosiExempt"] as const) {
        if (row[flag] && !["true", "false"].includes(row[flag].toLowerCase()))
          errors.push({ row: i + 1, message: `${flag} must be true or false` });
      }
      for (const num of ["annualLeaveDays", "basicSalary", "housingAllowance", "transportAllowance", "otherAllowance"] as const) {
        if (row[num] && isNaN(Number(row[num])))
          errors.push({ row: i + 1, message: `${num} must be numeric` });
      }
      for (const dateCol of ["iqamaExpiry", "passportExpiry"] as const) {
        if (row[dateCol] && isNaN(Date.parse(row[dateCol])))
          errors.push({ row: i + 1, message: `${dateCol} must be a valid date (YYYY-MM-DD)` });
      }
      if (seenCodes.has(row.code)) {
        errors.push({ row: i + 1, message: `Duplicate code ${row.code} within the file` });
      }
      seenCodes.add(row.code);
      rows.push(row);
    }

    if (errors.length > 0) {
      return { imported: 0, errors };
    }

    const imported = await this.prisma.$transaction(async (tx) => {
      // Resolve cost-center codes once per file
      const ccCodes = [...new Set(rows.map((r) => r.costCenterCode).filter(Boolean))];
      const ccs = await tx.costCenter.findMany({ where: { companyId, code: { in: ccCodes }, isActive: true } });
      const ccByCode = new Map(ccs.map((c) => [c.code, c.id]));
      for (const code of ccCodes) {
        if (!ccByCode.has(code)) {
          throw new BadRequestException(`Cost center ${code} not found or inactive`);
        }
      }

      const created: string[] = [];
      for (const row of rows) {
        const employee = await this.createInTx(tx, companyId, userId, {
          code: row.code,
          nameEn: row.nameEn,
          nameAr: row.nameAr || undefined,
          designation: row.designation || undefined,
          nationality: row.nationality || undefined,
          isSaudi: row.isSaudi.toLowerCase() === "true",
          iqamaOrNationalId: row.iqamaOrNationalId || undefined,
          iqamaExpiry: row.iqamaExpiry || undefined,
          passportNumber: row.passportNumber || undefined,
          passportExpiry: row.passportExpiry || undefined,
          gosiNumber: row.gosiNumber || undefined,
          joinDate: row.joinDate,
          contractType: (row.contractType || undefined) as CreateEmployeeDto["contractType"],
          bankCode: row.bankCode || undefined,
          iban: row.iban || undefined,
          costCenterId: row.costCenterCode ? ccByCode.get(row.costCenterCode) : undefined,
          annualLeaveDays: row.annualLeaveDays || settings.defaultAnnualLeaveDays.toString(),
          basicSalary: row.basicSalary || "0",
          housingAllowance: row.housingAllowance || "0",
          transportAllowance: row.transportAllowance || "0",
          otherAllowance: row.otherAllowance || "0",
          gosiExempt: row.gosiExempt.toLowerCase() === "true",
        });
        created.push(employee.id);
      }
      return created;
    });

    await this.auditService.log({
      companyId,
      entityName: "Employee",
      entityId: "csv-import",
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { importedCount: imported.length, employeeIds: imported },
    });

    return { imported: imported.length, errors: [] as ImportRowError[] };
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async createInTx(tx: Prisma.TransactionClient, companyId: string, userId: string, dto: CreateEmployeeDto) {
    const clash = await tx.employee.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (clash) {
      throw new ConflictException(`Employee code ${dto.code} already exists`);
    }
    if (dto.costCenterId) {
      await this.assertCostCenter(tx, companyId, dto.costCenterId);
    }
    const dec = (v: string | undefined, fallback = "0") => new Prisma.Decimal(v ?? fallback);
    return tx.employee.create({
      data: {
        companyId,
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        designation: dto.designation,
        nationality: dto.nationality,
        isSaudi: dto.isSaudi ?? false,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        iqamaOrNationalId: dto.iqamaOrNationalId,
        iqamaExpiry: dto.iqamaExpiry ? new Date(dto.iqamaExpiry) : null,
        passportNumber: dto.passportNumber,
        passportExpiry: dto.passportExpiry ? new Date(dto.passportExpiry) : null,
        gosiNumber: dto.gosiNumber,
        joinDate: new Date(dto.joinDate),
        contractType: dto.contractType,
        bankCode: dto.bankCode,
        iban: dto.iban,
        costCenterId: dto.costCenterId,
        annualLeaveDays: dec(dto.annualLeaveDays, "21"),
        leaveOpeningBalance: dec(dto.leaveOpeningBalance),
        basicSalary: dec(dto.basicSalary),
        housingAllowance: dec(dto.housingAllowance),
        transportAllowance: dec(dto.transportAllowance),
        otherAllowance: dec(dto.otherAllowance),
        gosiExempt: dto.gosiExempt ?? false,
        createdByUserId: userId,
      },
      include: { costCenter: { select: { code: true, name: true } } },
    });
  }

  private async assertCostCenter(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
    costCenterId: string,
  ) {
    const cc = await client.costCenter.findFirst({ where: { id: costCenterId, companyId, isActive: true } });
    if (!cc) {
      throw new BadRequestException("Cost center not found or inactive");
    }
    return cc;
  }
}
