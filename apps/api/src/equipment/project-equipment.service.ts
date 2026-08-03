import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateProjectEquipmentAssignmentDto, UpsertProjectEquipmentEntryDto } from "./dto/equipment.dtos";

const ZERO = new Prisma.Decimal(0);

/**
 * Internal-use equipment on our own projects — Hiace vans, buses, and
 * similar, never billed to a customer (that's EquipmentAssignment +
 * UsageLog, scoped to an EquipmentRentalContract). Cost accrues as a flat
 * dayRate for each day marked used; hoursUsed/overtimeHours are recorded
 * for reporting only, same convention as every other timesheet in the app.
 */
@Injectable()
export class ProjectEquipmentService {
  private static readonly ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listAssignments(companyId: string, projectId: string) {
    return this.prisma.projectEquipmentAssignment.findMany({
      where: { companyId, projectId },
      include: { equipment: { select: { code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async assign(companyId: string, userId: string, dto: CreateProjectEquipmentAssignmentDto) {
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, companyId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    const equipment = await this.prisma.equipment.findFirst({ where: { id: dto.equipmentId, companyId } });
    if (!equipment) {
      throw new NotFoundException("Equipment not found");
    }
    const dayRate = dto.dayRate !== undefined ? new Prisma.Decimal(dto.dayRate) : equipment.internalDayRate;
    if (!dayRate || dayRate.lte(0)) {
      throw new BadRequestException(
        "This equipment has no internalDayRate set — provide a dayRate for this assignment or set one on the equipment record first",
      );
    }

    const startDate = new Date(dto.startDate);

    // A physical unit can't be on two jobs at once — check against every
    // OTHER active assignment (rental or project) for an overlapping window.
    const overlappingRental = await this.prisma.equipmentAssignment.findFirst({
      where: { equipmentId: dto.equipmentId, isActive: true, OR: [{ endDate: null }, { endDate: { gte: startDate } }] },
    });
    if (overlappingRental) {
      throw new ConflictException("Equipment is already actively assigned to a rental contract for this period");
    }
    const overlappingProject = await this.prisma.projectEquipmentAssignment.findFirst({
      where: { equipmentId: dto.equipmentId, isActive: true, OR: [{ endDate: null }, { endDate: { gte: startDate } }] },
    });
    if (overlappingProject) {
      throw new ConflictException("Equipment is already actively assigned to another project for this period");
    }

    const assignment = await this.prisma.projectEquipmentAssignment.create({
      data: {
        companyId,
        projectId: dto.projectId,
        equipmentId: dto.equipmentId,
        dayRate,
        startDate,
        createdByUserId: userId,
      },
      include: { equipment: { select: { code: true, name: true } } },
    });

    await this.auditService.log({
      companyId,
      entityName: "ProjectEquipmentAssignment",
      entityId: assignment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { projectId: dto.projectId, equipmentId: dto.equipmentId, dayRate: dayRate.toString() },
    });

    return assignment;
  }

  async endAssignment(companyId: string, assignmentId: string, userId: string) {
    const assignment = await this.prisma.projectEquipmentAssignment.findFirst({ where: { id: assignmentId, companyId } });
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }
    const updated = await this.prisma.projectEquipmentAssignment.update({
      where: { id: assignmentId },
      data: { endDate: new Date(), isActive: false },
    });
    await this.auditService.log({
      companyId,
      entityName: "ProjectEquipmentAssignment",
      entityId: assignmentId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { isActive: false },
    });
    return updated;
  }

  /** Grid data for one project + period: every active-or-was-active assignment with entries in range. */
  async getTimesheet(companyId: string, projectId: string, fiscalPeriodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    const assignments = await this.prisma.projectEquipmentAssignment.findMany({
      where: { companyId, projectId },
      include: {
        equipment: { select: { code: true, name: true } },
        entries: { where: { date: { gte: period.startDate, lte: period.endDate } }, orderBy: { date: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });
    const attachment = await this.prisma.projectEquipmentPeriodAttachment.findFirst({
      where: { projectId, fiscalPeriodId },
      select: { filename: true },
    });
    return {
      fiscalPeriodId,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      periodAttachmentFilename: attachment?.filename ?? null,
      assignments: assignments.map((a) => ({
        assignmentId: a.id,
        equipmentCode: a.equipment.code,
        equipmentName: a.equipment.name,
        dayRate: a.dayRate,
        isActive: a.isActive,
        entries: a.entries.map((e) => ({
          id: e.id,
          date: e.date,
          used: e.used,
          hoursUsed: e.hoursUsed,
          overtimeHours: e.overtimeHours,
        })),
      })),
    };
  }

  /** One used/0h entry per calendar day of the period per assignment whose window covers that day. */
  async prefill(companyId: string, projectId: string, userId: string, fiscalPeriodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    const assignments = await this.prisma.projectEquipmentAssignment.findMany({ where: { companyId, projectId } });

    for (const assignment of assignments) {
      const from = assignment.startDate > period.startDate ? assignment.startDate : period.startDate;
      const to = assignment.endDate && assignment.endDate < period.endDate ? assignment.endDate : period.endDate;
      if (from > to) continue;

      const existing = await this.prisma.projectEquipmentLogEntry.findMany({
        where: { assignmentId: assignment.id, date: { gte: from, lte: to } },
        select: { date: true },
      });
      const existingDates = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));

      const rows: Prisma.ProjectEquipmentLogEntryCreateManyInput[] = [];
      for (
        let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
        day <= to;
        day = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1))
      ) {
        const key = day.toISOString().slice(0, 10);
        if (existingDates.has(key)) continue;
        rows.push({ assignmentId: assignment.id, companyId, date: day, used: false, enteredByUserId: userId });
      }
      if (rows.length > 0) {
        await this.prisma.projectEquipmentLogEntry.createMany({ data: rows });
      }
    }

    return this.getTimesheet(companyId, projectId, fiscalPeriodId);
  }

  async upsertEntry(companyId: string, userId: string, dto: UpsertProjectEquipmentEntryDto) {
    const assignment = await this.prisma.projectEquipmentAssignment.findFirst({
      where: { id: dto.assignmentId, companyId },
    });
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }
    const date = new Date(dto.date);
    const hoursUsed = dto.hoursUsed !== undefined ? new Prisma.Decimal(dto.hoursUsed) : undefined;
    const overtimeHours = dto.overtimeHours !== undefined ? new Prisma.Decimal(dto.overtimeHours) : undefined;

    await this.prisma.projectEquipmentLogEntry.upsert({
      where: { assignmentId_date: { assignmentId: dto.assignmentId, date } },
      create: {
        assignmentId: dto.assignmentId,
        companyId,
        date,
        used: dto.used ?? true,
        hoursUsed: hoursUsed ?? ZERO,
        overtimeHours: overtimeHours ?? ZERO,
        enteredByUserId: userId,
      },
      update: {
        used: dto.used,
        hoursUsed,
        overtimeHours,
        updatedByUserId: userId,
      },
    });
    return { updated: true };
  }

  async uploadPeriodAttachment(companyId: string, projectId: string, fiscalPeriodId: string, userId: string, file: Express.Multer.File) {
    if (!ProjectEquipmentService.ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Attachment must be an image (JPEG/PNG/WEBP/GIF) or a PDF");
    }
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }

    const attachment = await this.prisma.projectEquipmentPeriodAttachment.upsert({
      where: { projectId_fiscalPeriodId: { projectId, fiscalPeriodId } },
      create: {
        companyId,
        projectId,
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
      entityName: "ProjectEquipmentPeriodAttachment",
      entityId: attachment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: attachment,
    });

    return attachment;
  }

  async getPeriodAttachment(companyId: string, projectId: string, fiscalPeriodId: string) {
    const attachment = await this.prisma.projectEquipmentPeriodAttachment.findFirst({
      where: { projectId, fiscalPeriodId, companyId },
    });
    if (!attachment) {
      throw new NotFoundException("No attachment for this project's period");
    }
    return attachment;
  }
}
