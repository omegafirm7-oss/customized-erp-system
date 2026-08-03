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
import { UpsertUsageEntryDto } from "./dto/equipment.dtos";

@Injectable()
export class UsageLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(companyId: string, usageLogId: string) {
    const usageLog = await this.prisma.usageLog.findFirst({
      where: { id: usageLogId, companyId },
      include: {
        contract: {
          select: {
            id: true,
            code: true,
            name: true,
            businessPartner: { select: { code: true, name: true } },
            assignments: {
              where: { isActive: true },
              include: { equipment: { select: { code: true, name: true } } },
            },
          },
        },
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
        entries: {
          orderBy: [{ date: "asc" }],
          include: { attachment: { select: { filename: true } } },
        },
      },
    });
    if (!usageLog) {
      throw new NotFoundException("Usage log not found");
    }
    return usageLog;
  }

  async create(companyId: string, contractId: string, userId: string, fiscalPeriodId: string) {
    const usageLogId = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.equipmentRentalContract.findFirst({ where: { id: contractId, companyId } });
      if (!contract) {
        throw new NotFoundException("Equipment rental contract not found");
      }
      if (contract.status !== ManpowerContractStatus.ACTIVE) {
        throw new ConflictException("Usage logs require an ACTIVE contract");
      }
      const period = await tx.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
      if (!period) {
        throw new NotFoundException("Fiscal period not found");
      }
      const existing = await tx.usageLog.findUnique({
        where: { contractId_fiscalPeriodId: { contractId, fiscalPeriodId } },
      });
      if (existing) {
        throw new ConflictException("A usage log already exists for this contract and period");
      }

      const usageLog = await tx.usageLog.create({
        data: { companyId, contractId, fiscalPeriodId, createdByUserId: userId },
      });
      await this.prefillInTx(tx, companyId, usageLog.id, contractId, period.startDate, period.endDate);
      return usageLog.id;
    });

    await this.auditService.log({
      companyId,
      entityName: "UsageLog",
      entityId: usageLogId,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { contractId, fiscalPeriodId },
    });

    return this.get(companyId, usageLogId);
  }

  async prefill(companyId: string, usageLogId: string) {
    await this.prisma.$transaction(async (tx) => {
      const usageLog = await this.getDraft(tx, companyId, usageLogId);
      const period = await tx.fiscalPeriod.findFirstOrThrow({ where: { id: usageLog.fiscalPeriodId } });
      await this.prefillInTx(tx, companyId, usageLogId, usageLog.contractId, period.startDate, period.endDate);
    });
    return this.get(companyId, usageLogId);
  }

  async upsertEntry(companyId: string, usageLogId: string, dto: UpsertUsageEntryDto) {
    await this.prisma.$transaction(async (tx) => {
      const usageLog = await this.getDraft(tx, companyId, usageLogId);
      const assignment = await tx.equipmentAssignment.findFirst({
        where: { id: dto.assignmentId, contractId: usageLog.contractId },
      });
      if (!assignment) {
        throw new BadRequestException("Assignment does not belong to this usage log's contract");
      }
      const period = await tx.fiscalPeriod.findFirstOrThrow({ where: { id: usageLog.fiscalPeriodId } });
      const date = new Date(dto.date);
      if (date < period.startDate || date > period.endDate) {
        throw new BadRequestException("Entry date is outside the log's fiscal period");
      }

      const hoursUsed = dto.hoursUsed !== undefined ? new Prisma.Decimal(dto.hoursUsed) : undefined;
      const overtimeHours = dto.overtimeHours !== undefined ? new Prisma.Decimal(dto.overtimeHours) : undefined;
      await tx.usageLogEntry.upsert({
        where: {
          usageLogId_assignmentId_date: { usageLogId, assignmentId: dto.assignmentId, date },
        },
        create: {
          usageLogId,
          companyId,
          assignmentId: dto.assignmentId,
          equipmentId: assignment.equipmentId,
          date,
          dayStatus: dto.dayStatus,
          hoursUsed: hoursUsed ?? new Prisma.Decimal(0),
          overtimeHours: overtimeHours ?? new Prisma.Decimal(0),
        },
        update: { dayStatus: dto.dayStatus, hoursUsed, overtimeHours },
      });
    });
    return { updated: true };
  }

  async approve(companyId: string, usageLogId: string, userId: string) {
    const approved = await this.prisma.$transaction(async (tx) => {
      const usageLog = await this.getDraft(tx, companyId, usageLogId);
      const entryCount = await tx.usageLogEntry.count({ where: { usageLogId } });
      if (entryCount === 0) {
        throw new BadRequestException("Usage log has no entries");
      }
      return tx.usageLog.update({
        where: { id: usageLog.id },
        data: { status: TimesheetStatus.APPROVED, approvedByUserId: userId, approvedAt: new Date() },
      });
    });
    await this.auditService.log({
      companyId,
      entityName: "UsageLog",
      entityId: usageLogId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: TimesheetStatus.APPROVED },
    });
    return approved;
  }

  async reopen(companyId: string, usageLogId: string, userId: string) {
    const reopened = await this.prisma.$transaction(async (tx) => {
      const usageLog = await tx.usageLog.findFirst({
        where: { id: usageLogId, companyId },
        include: { salesInvoice: { select: { status: true } } },
      });
      if (!usageLog) {
        throw new NotFoundException("Usage log not found");
      }
      if (usageLog.status === TimesheetStatus.APPROVED) {
        return tx.usageLog.update({
          where: { id: usageLogId },
          data: { status: TimesheetStatus.DRAFT, approvedByUserId: null, approvedAt: null },
        });
      }
      if (usageLog.status === TimesheetStatus.INVOICED) {
        if (usageLog.salesInvoice && usageLog.salesInvoice.status !== InvoiceStatus.CANCELLED) {
          throw new ConflictException("Linked invoice is not cancelled — cancel it before reopening");
        }
        return tx.usageLog.update({
          where: { id: usageLogId },
          data: { status: TimesheetStatus.APPROVED, salesInvoiceId: null },
        });
      }
      throw new ConflictException("Usage log is already a draft");
    });
    await this.auditService.log({
      companyId,
      entityName: "UsageLog",
      entityId: usageLogId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: reopened.status },
    });
    return reopened;
  }

  async deleteDraft(companyId: string, usageLogId: string) {
    await this.prisma.$transaction(async (tx) => {
      const usageLog = await this.getDraft(tx, companyId, usageLogId);
      await tx.usageLog.delete({ where: { id: usageLog.id } });
    });
    return { deleted: true };
  }

  private static readonly ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);

  /** Attaches (or replaces) the evidence file for one day's usage-log entry. */
  async uploadEntryAttachment(companyId: string, entryId: string, userId: string, file: Express.Multer.File) {
    if (!UsageLogsService.ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Attachment must be an image (JPEG/PNG/WEBP/GIF) or a PDF");
    }
    const entry = await this.prisma.usageLogEntry.findFirst({ where: { id: entryId, companyId } });
    if (!entry) {
      throw new NotFoundException("Usage log entry not found");
    }

    await this.prisma.usageLogEntryAttachment.upsert({
      where: { usageLogEntryId: entryId },
      create: {
        companyId,
        usageLogEntryId: entryId,
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
    });
    return { uploaded: true };
  }

  async getEntryAttachment(companyId: string, entryId: string) {
    const attachment = await this.prisma.usageLogEntryAttachment.findFirst({
      where: { usageLogEntryId: entryId, companyId },
    });
    if (!attachment) {
      throw new NotFoundException("No attachment on this usage log entry");
    }
    return attachment;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async getDraft(tx: Prisma.TransactionClient, companyId: string, usageLogId: string) {
    const usageLog = await tx.usageLog.findFirst({ where: { id: usageLogId, companyId } });
    if (!usageLog) {
      throw new NotFoundException("Usage log not found");
    }
    if (usageLog.status !== TimesheetStatus.DRAFT) {
      throw new ConflictException(`Usage log is ${usageLog.status} — only drafts can be modified`);
    }
    return usageLog;
  }

  /** One ON_RENT entry per calendar day per active assignment; keeps existing. */
  private async prefillInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    usageLogId: string,
    contractId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const assignments = await tx.equipmentAssignment.findMany({ where: { contractId, isActive: true } });
    const existing = await tx.usageLogEntry.findMany({
      where: { usageLogId },
      select: { assignmentId: true, date: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.assignmentId}|${e.date.toISOString().slice(0, 10)}`));

    const rows: Prisma.UsageLogEntryCreateManyInput[] = [];
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
          usageLogId,
          companyId,
          assignmentId: assignment.id,
          equipmentId: assignment.equipmentId,
          date: day,
        });
      }
    }
    if (rows.length > 0) {
      await tx.usageLogEntry.createMany({ data: rows });
    }
  }
}
