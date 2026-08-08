import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateActivityDto } from "./dto/create-activity.dto";
import { UpdateActivityDto } from "./dto/update-activity.dto";

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, filter: { leadId?: string; opportunityId?: string; businessPartnerId?: string }) {
    return this.prisma.crmActivity.findMany({
      where: { companyId, ...filter },
      orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
  }

  async create(companyId: string, userId: string, dto: CreateActivityDto) {
    const targets = [dto.leadId, dto.opportunityId, dto.businessPartnerId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException("Exactly one of leadId, opportunityId, or businessPartnerId is required");
    }
    const activity = await this.prisma.crmActivity.create({
      data: {
        companyId,
        type: dto.type,
        subject: dto.subject,
        notes: dto.notes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ownerUserId: dto.ownerUserId ?? userId,
        leadId: dto.leadId,
        opportunityId: dto.opportunityId,
        businessPartnerId: dto.businessPartnerId,
        createdByUserId: userId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "CrmActivity",
      entityId: activity.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: activity,
    });
    return activity;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateActivityDto) {
    const before = await this.getOwned(companyId, id);
    const updated = await this.prisma.crmActivity.update({
      where: { id },
      data: {
        subject: dto.subject,
        notes: dto.notes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        completedAt: dto.completed === undefined ? undefined : dto.completed ? new Date() : null,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "CrmActivity",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async delete(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    await this.prisma.crmActivity.delete({ where: { id } });
    await this.auditService.log({
      companyId,
      entityName: "CrmActivity",
      entityId: id,
      action: "DELETE",
      changedByUserId: userId,
      beforeSnapshot: before,
    });
  }

  private async getOwned(companyId: string, id: string) {
    const activity = await this.prisma.crmActivity.findFirst({ where: { id, companyId } });
    if (!activity) {
      throw new NotFoundException("Activity not found");
    }
    return activity;
  }
}
