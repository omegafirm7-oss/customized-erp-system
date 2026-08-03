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
          select: {
            id: true,
            date: true,
            dayType: true,
            hoursWorked: true,
            overtimeHours: true,
          },
        },
      },
    });
    const periodAttachment = await this.getPeriodAttachmentMeta(companyId, fiscalPeriodId);
    return {
      fiscalPeriodId,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      periodAttachmentFilename: periodAttachment?.filename ?? null,
      employees: employees.map((e) => ({
        employeeId: e.id,
        code: e.code,
        nameEn: e.nameEn,
        designation: e.designation,
        basicSalary: e.basicSalary,
        entries: e.employeeTimesheetEntries.map((entry) => ({
          id: entry.id,
          date: entry.date,
          dayType: entry.dayType,
          hoursWorked: entry.hoursWorked,
          overtimeHours: entry.overtimeHours,
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
      select: {
        id: true,
        date: true,
        dayType: true,
        hoursWorked: true,
        overtimeHours: true,
      },
    });

    const hourlyRate = employee.basicSalary.div(HOURLY_DIVISOR).toDecimalPlaces(4);
    let totalHours = new Prisma.Decimal(0);
    let totalOvertimeHours = new Prisma.Decimal(0);
    let totalCost = new Prisma.Decimal(0);
    const rows = entries.map((e) => {
      // Cost deliberately ignores overtimeHours — overtime is recorded for
      // reporting only and is paid through the payroll run, not accrued here.
      const cost = hourlyRate.mul(e.hoursWorked).toDecimalPlaces(2);
      totalHours = totalHours.add(e.hoursWorked);
      totalOvertimeHours = totalOvertimeHours.add(e.overtimeHours);
      totalCost = totalCost.add(cost);
      return {
        id: e.id,
        date: e.date,
        dayType: e.dayType,
        hoursWorked: e.hoursWorked,
        overtimeHours: e.overtimeHours,
        cost,
      };
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
      totalOvertimeHours,
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

    // Overtime is edited on its own tab, so a day-type/hours edit must not
    // clobber it: left `undefined` here, Prisma skips the column entirely and
    // whatever was recorded survives. The one exception is switching a day to
    // a non-worked type, where carrying overtime forward would be nonsense.
    const overtimeHours =
      dto.overtimeHours !== undefined
        ? new Prisma.Decimal(dto.overtimeHours)
        : dto.dayType === TimesheetDayType.WORKED
          ? undefined
          : new Prisma.Decimal(0);
    if (overtimeHours && (overtimeHours.lt(0) || overtimeHours.gt(24))) {
      throw new BadRequestException(`overtimeHours must be between 0 and 24 (got ${overtimeHours.toString()})`);
    }

    await this.prisma.employeeTimesheetEntry.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
      create: {
        companyId,
        employeeId: dto.employeeId,
        date,
        dayType: dto.dayType,
        hoursWorked,
        overtimeHours: overtimeHours ?? new Prisma.Decimal(0),
        enteredByUserId: userId,
      },
      update: {
        dayType: dto.dayType,
        hoursWorked,
        overtimeHours,
        updatedByUserId: userId,
      },
    });

    return { updated: true };
  }

  /**
   * Explicit, opt-in bulk clear: zeroes hoursWorked and overtimeHours
   * (dayType untouched) for every entry in one period. For periods that were
   * prefilled before hours defaulted to 0 (or that just need a clean slate)
   * — never runs automatically, only when the user asks for this period.
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
      data: { hoursWorked: ZERO_HOURS, overtimeHours: ZERO_HOURS, updatedByUserId: userId },
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

  private static readonly ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);

  /**
   * Attaches (or replaces) the evidence file for a whole fiscal period — one
   * scanned document per month (e.g. the signed paper timesheet), not one
   * per employee per day.
   */
  async uploadPeriodAttachment(companyId: string, fiscalPeriodId: string, userId: string, file: Express.Multer.File) {
    if (!AttendanceService.ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Attachment must be an image (JPEG/PNG/WEBP/GIF) or a PDF");
    }
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }

    const attachment = await this.prisma.timesheetPeriodAttachment.upsert({
      where: { fiscalPeriodId },
      create: {
        companyId,
        fiscalPeriodId,
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
      entityName: "TimesheetPeriodAttachment",
      entityId: attachment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: attachment,
    });

    return attachment;
  }

  async getPeriodAttachmentMeta(companyId: string, fiscalPeriodId: string) {
    return this.prisma.timesheetPeriodAttachment.findFirst({
      where: { fiscalPeriodId, companyId },
      select: { filename: true },
    });
  }

  async getPeriodAttachment(companyId: string, fiscalPeriodId: string) {
    const attachment = await this.prisma.timesheetPeriodAttachment.findFirst({
      where: { fiscalPeriodId, companyId },
    });
    if (!attachment) {
      throw new NotFoundException("No attachment for this period");
    }
    return attachment;
  }
}
