import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";

/**
 * Leads are the top of the CRM funnel — unqualified inbound/outbound
 * interest, not yet tied to a real deal. No GL posting anywhere in CRM;
 * this is pure pipeline tracking.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: LeadStatus) {
    return this.prisma.lead.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreateLeadDto) {
    const lead = await this.prisma.lead.create({
      data: {
        companyId,
        name: dto.name,
        companyName: dto.companyName,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
        notes: dto.notes,
        ownerUserId: dto.ownerUserId ?? userId,
        createdByUserId: userId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Lead",
      entityId: lead.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: lead,
    });
    return lead;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateLeadDto) {
    const before = await this.getOwned(companyId, id);
    if (before.status === LeadStatus.CONVERTED) {
      throw new ConflictException("This lead has already been converted to an opportunity and is read-only");
    }
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        name: dto.name,
        companyName: dto.companyName,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
        status: dto.status,
        notes: dto.notes,
        ownerUserId: dto.ownerUserId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Lead",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  /** Marks the lead CONVERTED and links it to the opportunity created for it — called by OpportunitiesService.convertLead. */
  async markConverted(companyId: string, id: string, opportunityId: string, userId: string) {
    const linked = await this.prisma.lead.updateMany({
      where: { id, companyId, status: { not: LeadStatus.CONVERTED } },
      data: { status: LeadStatus.CONVERTED, convertedOpportunityId: opportunityId },
    });
    if (linked.count === 0) {
      throw new ConflictException("Lead status changed while converting it to an opportunity");
    }
    await this.auditService.log({
      companyId,
      entityName: "Lead",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: LeadStatus.CONVERTED, convertedOpportunityId: opportunityId },
    });
  }

  private async getOwned(companyId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }
    return lead;
  }
}
