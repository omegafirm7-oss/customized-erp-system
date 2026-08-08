import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadStatus, OpportunityStage } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LeadsService } from "./leads.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { LoseOpportunityDto, UpdateOpportunityDto } from "./dto/update-opportunity.dto";

const CLOSED_STAGES: OpportunityStage[] = [OpportunityStage.WON, OpportunityStage.LOST];

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly leadsService: LeadsService,
  ) {}

  async list(companyId: string, stage?: OpportunityStage) {
    return this.prisma.opportunity.findMany({
      where: { companyId, ...(stage ? { stage } : {}) },
      orderBy: { createdAt: "desc" },
      include: { businessPartner: { select: { code: true, name: true } }, leadSource: { select: { name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreateOpportunityDto) {
    if (dto.businessPartnerId) {
      await this.assertPartnerOwned(companyId, dto.businessPartnerId);
    }
    const opportunity = await this.prisma.opportunity.create({
      data: {
        companyId,
        name: dto.name,
        businessPartnerId: dto.businessPartnerId,
        leadId: dto.leadId,
        stage: dto.stage,
        estimatedValue: dto.estimatedValue,
        probability: dto.probability,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
        ownerUserId: dto.ownerUserId ?? userId,
        createdByUserId: userId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Opportunity",
      entityId: opportunity.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: opportunity,
    });
    return opportunity;
  }

  /** Qualifies a lead directly into a new opportunity, in one step. */
  async convertLead(companyId: string, leadId: string, userId: string, dto: CreateOpportunityDto) {
    const lead = await this.leadsService.get(companyId, leadId);
    if (lead.status === LeadStatus.CONVERTED) {
      throw new ConflictException("This lead has already been converted to an opportunity");
    }
    const opportunity = await this.create(companyId, userId, { ...dto, leadId });
    await this.leadsService.markConverted(companyId, leadId, opportunity.id, userId);
    return opportunity;
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateOpportunityDto) {
    const before = await this.getOwned(companyId, id);
    if (CLOSED_STAGES.includes(before.stage)) {
      throw new ConflictException("This opportunity is closed (won/lost) and cannot be edited — reopen it first if needed");
    }
    if (dto.businessPartnerId) {
      await this.assertPartnerOwned(companyId, dto.businessPartnerId);
    }
    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: {
        name: dto.name,
        businessPartnerId: dto.businessPartnerId,
        stage: dto.stage,
        estimatedValue: dto.estimatedValue,
        probability: dto.probability,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
        ownerUserId: dto.ownerUserId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "Opportunity",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async win(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (CLOSED_STAGES.includes(before.stage)) {
      throw new ConflictException("This opportunity is already closed");
    }
    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: { stage: OpportunityStage.WON, probability: 100, wonAt: new Date() },
    });
    await this.auditService.log({
      companyId,
      entityName: "Opportunity",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async lose(companyId: string, id: string, userId: string, dto: LoseOpportunityDto) {
    const before = await this.getOwned(companyId, id);
    if (CLOSED_STAGES.includes(before.stage)) {
      throw new ConflictException("This opportunity is already closed");
    }
    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: { stage: OpportunityStage.LOST, probability: 0, lostAt: new Date(), lostReason: dto.lostReason },
    });
    await this.auditService.log({
      companyId,
      entityName: "Opportunity",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  private async getOwned(companyId: string, id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, companyId },
      include: { businessPartner: true, leadSource: true },
    });
    if (!opportunity) {
      throw new NotFoundException("Opportunity not found");
    }
    return opportunity;
  }

  private async assertPartnerOwned(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId } });
    if (!partner) {
      throw new BadRequestException("Business partner not found");
    }
  }
}
