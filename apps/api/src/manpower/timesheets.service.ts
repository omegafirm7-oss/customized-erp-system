import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InvoiceStatus,
  ManpowerContractStatus,
  Prisma,
  TimesheetStatus,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpsertEntryDto } from "./dto/manpower.dtos";

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(companyId: string, timesheetId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId },
      include: {
        contract: {
          select: {
            id: true,
            code: true,
            name: true,
            businessPartner: { select: { code: true, name: true } },
            assignments: {
              where: { isActive: true },
              include: { employee: { select: { code: true, nameEn: true } } },
            },
          },
        },
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
        entries: { orderBy: [{ date: "asc" }] },
      },
    });
    if (!timesheet) {
      throw new NotFoundException("Timesheet not found");
    }
    return timesheet;
  }

  /** Creates the (contract, period) timesheet and prefills every calendar day. */
  async create(companyId: string, contractId: string, userId: string, fiscalPeriodId: string) {
    const timesheetId = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.manpowerContract.findFirst({ where: { id: contractId, companyId } });
      if (!contract) {
        throw new NotFoundException("Manpower contract not found");
      }
      if (contract.status !== ManpowerContractStatus.ACTIVE) {
        throw new ConflictException("Timesheets require an ACTIVE contract");
      }
      const period = await tx.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
      if (!period) {
        throw new NotFoundException("Fiscal period not found");
      }
      const existing = await tx.timesheet.findUnique({
        where: { contractId_fiscalPeriodId: { contractId, fiscalPeriodId } },
      });
      if (existing) {
        throw new ConflictException("A timesheet already exists for this contract and period");
      }

      const timesheet = await tx.timesheet.create({
        data: { companyId, contractId, fiscalPeriodId, createdByUserId: userId },
      });
      await this.prefillInTx(tx, companyId, timesheet.id, contractId, period.startDate, period.endDate);
      return timesheet.id;
    });

    await this.auditService.log({
      companyId,
      entityName: "Timesheet",
      entityId: timesheetId,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { contractId, fiscalPeriodId },
    });

    return this.get(companyId, timesheetId);
  }

  /** Re-prefill (e.g. after adding an assignment) — existing entries are kept. */
  async prefill(companyId: string, timesheetId: string) {
    await this.prisma.$transaction(async (tx) => {
      const timesheet = await this.getDraft(tx, companyId, timesheetId);
      const period = await tx.fiscalPeriod.findFirstOrThrow({ where: { id: timesheet.fiscalPeriodId } });
      await this.prefillInTx(tx, companyId, timesheetId, timesheet.contractId, period.startDate, period.endDate);
    });
    return this.get(companyId, timesheetId);
  }

  async upsertEntry(companyId: string, timesheetId: string, dto: UpsertEntryDto) {
    await this.prisma.$transaction(async (tx) => {
      const timesheet = await this.getDraft(tx, companyId, timesheetId);
      const assignment = await tx.manpowerAssignment.findFirst({
        where: { id: dto.assignmentId, contractId: timesheet.contractId },
      });
      if (!assignment) {
        throw new BadRequestException("Assignment does not belong to this timesheet's contract");
      }
      const period = await tx.fiscalPeriod.findFirstOrThrow({ where: { id: timesheet.fiscalPeriodId } });
      const date = new Date(dto.date);
      if (date < period.startDate || date > period.endDate) {
        throw new BadRequestException("Entry date is outside the timesheet's fiscal period");
      }

      const hours = dto.hours !== undefined ? new Prisma.Decimal(dto.hours) : undefined;
      const overtimeHours = dto.overtimeHours !== undefined ? new Prisma.Decimal(dto.overtimeHours) : undefined;
      await tx.timesheetEntry.upsert({
        where: {
          timesheetId_assignmentId_date: { timesheetId, assignmentId: dto.assignmentId, date },
        },
        create: {
          timesheetId,
          companyId,
          assignmentId: dto.assignmentId,
          employeeId: assignment.employeeId,
          date,
          dayType: dto.dayType,
          hours: hours ?? new Prisma.Decimal(0),
          overtimeHours: overtimeHours ?? new Prisma.Decimal(0),
        },
        update: { dayType: dto.dayType, hours, overtimeHours },
      });
    });
    return { updated: true };
  }

  async approve(companyId: string, timesheetId: string, userId: string) {
    const approved = await this.prisma.$transaction(async (tx) => {
      const timesheet = await this.getDraft(tx, companyId, timesheetId);
      const entryCount = await tx.timesheetEntry.count({ where: { timesheetId } });
      if (entryCount === 0) {
        throw new BadRequestException("Timesheet has no entries");
      }
      return tx.timesheet.update({
        where: { id: timesheet.id },
        data: { status: TimesheetStatus.APPROVED, approvedByUserId: userId, approvedAt: new Date() },
      });
    });
    await this.auditService.log({
      companyId,
      entityName: "Timesheet",
      entityId: timesheetId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: TimesheetStatus.APPROVED },
    });
    return approved;
  }

  /**
   * APPROVED → DRAFT (unlock for edits), or INVOICED → APPROVED when the
   * linked invoice was cancelled (allows re-billing).
   */
  async reopen(companyId: string, timesheetId: string, userId: string) {
    const reopened = await this.prisma.$transaction(async (tx) => {
      const timesheet = await tx.timesheet.findFirst({
        where: { id: timesheetId, companyId },
        include: { salesInvoice: { select: { status: true } } },
      });
      if (!timesheet) {
        throw new NotFoundException("Timesheet not found");
      }
      if (timesheet.status === TimesheetStatus.APPROVED) {
        return tx.timesheet.update({
          where: { id: timesheetId },
          data: { status: TimesheetStatus.DRAFT, approvedByUserId: null, approvedAt: null },
        });
      }
      if (timesheet.status === TimesheetStatus.INVOICED) {
        if (timesheet.salesInvoice && timesheet.salesInvoice.status !== InvoiceStatus.CANCELLED) {
          throw new ConflictException("Linked invoice is not cancelled — cancel it before reopening");
        }
        return tx.timesheet.update({
          where: { id: timesheetId },
          data: { status: TimesheetStatus.APPROVED, salesInvoiceId: null },
        });
      }
      throw new ConflictException("Timesheet is already a draft");
    });
    await this.auditService.log({
      companyId,
      entityName: "Timesheet",
      entityId: timesheetId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: reopened.status },
    });
    return reopened;
  }

  async deleteDraft(companyId: string, timesheetId: string) {
    await this.prisma.$transaction(async (tx) => {
      const timesheet = await this.getDraft(tx, companyId, timesheetId);
      await tx.timesheet.delete({ where: { id: timesheet.id } });
    });
    return { deleted: true };
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async getDraft(tx: Prisma.TransactionClient, companyId: string, timesheetId: string) {
    const timesheet = await tx.timesheet.findFirst({ where: { id: timesheetId, companyId } });
    if (!timesheet) {
      throw new NotFoundException("Timesheet not found");
    }
    if (timesheet.status !== TimesheetStatus.DRAFT) {
      throw new ConflictException(`Timesheet is ${timesheet.status} — only drafts can be modified`);
    }
    return timesheet;
  }

  /**
   * One WORKED entry per calendar day of the period per active assignment
   * whose window overlaps that day. Hours default to HrSettings.hoursPerDay.
   * Existing entries (same assignment+date) are left untouched.
   */
  private async prefillInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    timesheetId: string,
    contractId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const settings = await tx.hrSettings.findUniqueOrThrow({ where: { companyId } });
    const assignments = await tx.manpowerAssignment.findMany({ where: { contractId, isActive: true } });
    const existing = await tx.timesheetEntry.findMany({
      where: { timesheetId },
      select: { assignmentId: true, date: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.assignmentId}|${e.date.toISOString().slice(0, 10)}`));

    const rows: Prisma.TimesheetEntryCreateManyInput[] = [];
    for (const assignment of assignments) {
      const from = assignment.startDate > periodStart ? assignment.startDate : periodStart;
      const to = assignment.endDate && assignment.endDate < periodEnd ? assignment.endDate : periodEnd;
      for (
        let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
        day <= to;
        day = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1))
      ) {
        const key = `${assignment.id}|${day.toISOString().slice(0, 10)}`;
        if (existingKeys.has(key)) continue;
        rows.push({
          timesheetId,
          companyId,
          assignmentId: assignment.id,
          employeeId: assignment.employeeId,
          date: day,
          hours: settings.hoursPerDay,
        });
      }
    }
    if (rows.length > 0) {
      await tx.timesheetEntry.createMany({ data: rows });
    }
  }
}
