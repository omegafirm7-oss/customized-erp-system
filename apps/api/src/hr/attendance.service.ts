import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeStatus, Prisma, TimesheetDayType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpsertTimesheetEntryDto } from "./dto/hr.dtos";

const ZERO_HOURS = new Prisma.Decimal(0);
const STANDARD_WORKDAY_HOURS = new Prisma.Decimal(10);

/**
 * Default hours when a single day's entry is edited without an explicit
 * hours value: WORKED assumes the standard 10-hour day (still fully
 * editable), everything else (REST/ABSENT/UNPAID_LEAVE/ANNUAL_LEAVE) is 0.
 * Bulk prefill is intentionally NOT covered by this — it always creates
 * blank (0h) placeholders regardless of dayType, so a never-touched day
 * never silently counts as a full paid day (see prefillPeriod).
 */
function defaultHoursForManualEdit(dayType: TimesheetDayType): Prisma.Decimal {
  return dayType === TimesheetDayType.WORKED ? STANDARD_WORKDAY_HOURS : ZERO_HOURS;
}

/**
 * Day-by-day internal labor timesheet used for the per-project day-cost
 * Overview — one entry per active employee per calendar day, entered
 * directly (matches a real attendance sheet) rather than derived from
 * payroll exceptions. Payroll-independent, and distinct from the manpower
 * Timesheet/TimesheetEntry models, which are client-billing documents tied
 * to a ManpowerContract and customer invoice.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Grid data for a fiscal period: every active employee with their entries in range. */
  async getPeriod(companyId: string, fiscalPeriodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: EmployeeStatus.ACTIVE },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        designation: true,
        basicSalary: true,
        employeeTimesheetEntries: {
          where: { date: { gte: period.startDate, lte: period.endDate } },
          orderBy: { date: "asc" },
        },
      },
    });
    return {
      fiscalPeriodId,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      employees: employees.map((e) => ({
        employeeId: e.id,
        code: e.code,
        nameEn: e.nameEn,
        designation: e.designation,
        basicSalary: e.basicSalary,
        entries: e.employeeTimesheetEntries.map((entry) => ({
          date: entry.date,
          dayType: entry.dayType,
          hoursWorked: entry.hoursWorked,
        })),
      })),
    };
  }

  /**
   * Per-employee timesheet history for the Employee Detail page's
   * "Timesheets" button — every day entry for one employee, optionally
   * scoped to one fiscal period, with per-day cost (hourlyRate × hours,
   * same 26-day/10-hour convention as hr-reports.service.ts). Available
   * for released employees too — their history doesn't disappear on release.
   */
  async timesheetDetail(companyId: string, employeeId: string, fiscalPeriodId?: string) {
    const HOURLY_DIVISOR = new Prisma.Decimal(260);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, code: true, nameEn: true, basicSalary: true, status: true },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }

    let period: { id: string; periodNumber: number; startDate: Date; endDate: Date } | null = null;
    if (fiscalPeriodId) {
      period = await this.prisma.fiscalPeriod.findFirst({
        where: { id: fiscalPeriodId, companyId },
        select: { id: true, periodNumber: true, startDate: true, endDate: true },
      });
      if (!period) {
        throw new NotFoundException("Fiscal period not found");
      }
    }

    const entries = await this.prisma.employeeTimesheetEntry.findMany({
      where: { employeeId, ...(period ? { date: { gte: period.startDate, lte: period.endDate } } : {}) },
      orderBy: { date: "asc" },
      select: { date: true, dayType: true, hoursWorked: true },
    });

    const hourlyRate = employee.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
    let totalHours = new Prisma.Decimal(0);
    let totalCost = new Prisma.Decimal(0);
    const rows = entries.map((e) => {
      const cost = hourlyRate.mul(e.hoursWorked).toDecimalPlaces(2);
      totalHours = totalHours.add(e.hoursWorked);
      totalCost = totalCost.add(cost);
      return { date: e.date, dayType: e.dayType, hoursWorked: e.hoursWorked, cost };
    });

    return {
      scope: period ? ("period" as const) : ("overall" as const),
      fiscalPeriodId: period?.id ?? null,
      employeeId: employee.id,
      code: employee.code,
      nameEn: employee.nameEn,
      hourlyRate,
      entries: rows,
      totalHours,
      totalCost,
    };
  }

  /**
   * One WORKED/0h entry per calendar day of the period per active employee
   * whose join date falls within (or before) the period — hours are always
   * entered explicitly afterwards, never assumed. Existing entries (same
   * employee+date) are left untouched — safe to re-run.
   */
  async prefillPeriod(companyId: string, fiscalPeriodId: string, userId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }

    await this.prisma.$transaction(async (tx) => {
      const employees = await tx.employee.findMany({
        where: { companyId, status: EmployeeStatus.ACTIVE },
        select: { id: true, joinDate: true },
      });
      const existing = await tx.employeeTimesheetEntry.findMany({
        where: {
          employeeId: { in: employees.map((e) => e.id) },
          date: { gte: period.startDate, lte: period.endDate },
        },
        select: { employeeId: true, date: true },
      });
      const existingKeys = new Set(existing.map((e) => `${e.employeeId}|${e.date.toISOString().slice(0, 10)}`));

      const rows: Prisma.EmployeeTimesheetEntryCreateManyInput[] = [];
      for (const employee of employees) {
        const from = employee.joinDate > period.startDate ? employee.joinDate : period.startDate;
        for (
          let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
          day <= period.endDate;
          day = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1))
        ) {
          const key = `${employee.id}|${day.toISOString().slice(0, 10)}`;
          if (existingKeys.has(key)) continue;
          rows.push({
            companyId,
            employeeId: employee.id,
            date: day,
            dayType: TimesheetDayType.WORKED,
            hoursWorked: ZERO_HOURS,
            enteredByUserId: userId,
          });
        }
      }
      if (rows.length > 0) {
        await tx.employeeTimesheetEntry.createMany({ data: rows });
      }
    });

    await this.auditService.log({
      companyId,
      entityName: "EmployeeTimesheetEntry",
      entityId: fiscalPeriodId,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { fiscalPeriodId, action: "prefill" },
    });

    return this.getPeriod(companyId, fiscalPeriodId);
  }

  /** Create or edit a single day's entry (dayType + optional hours override). */
  async upsertEntry(companyId: string, userId: string, dto: UpsertTimesheetEntryDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId, status: EmployeeStatus.ACTIVE },
    });
    if (!employee) {
      throw new BadRequestException("Employee not found or inactive");
    }
    const date = new Date(dto.date);
    const hoursWorked = dto.hoursWorked !== undefined ? new Prisma.Decimal(dto.hoursWorked) : defaultHoursForManualEdit(dto.dayType);
    if (hoursWorked.lt(0) || hoursWorked.gt(24)) {
      throw new BadRequestException(`hoursWorked must be between 0 and 24 (got ${hoursWorked.toString()})`);
    }

    await this.prisma.employeeTimesheetEntry.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
      create: {
        companyId,
        employeeId: dto.employeeId,
        date,
        dayType: dto.dayType,
        hoursWorked,
        enteredByUserId: userId,
      },
      update: {
        dayType: dto.dayType,
        hoursWorked,
        updatedByUserId: userId,
      },
    });

    return { updated: true };
  }

  /**
   * Explicit, opt-in bulk clear: zeroes hoursWorked (dayType untouched) for
   * every entry in one period. For periods that were prefilled before hours
   * defaulted to 0 (or that just need a clean slate) — never runs
   * automatically, only when the user asks for this specific period.
   */
  async resetPeriodHours(companyId: string, fiscalPeriodId: string, userId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    const employeeIds = (
      await this.prisma.employee.findMany({ where: { companyId }, select: { id: true } })
    ).map((e) => e.id);

    await this.prisma.employeeTimesheetEntry.updateMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.startDate, lte: period.endDate } },
      data: { hoursWorked: ZERO_HOURS, updatedByUserId: userId },
    });

    await this.auditService.log({
      companyId,
      entityName: "EmployeeTimesheetEntry",
      entityId: fiscalPeriodId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { fiscalPeriodId, action: "reset-hours" },
    });

    return this.getPeriod(companyId, fiscalPeriodId);
  }
}
