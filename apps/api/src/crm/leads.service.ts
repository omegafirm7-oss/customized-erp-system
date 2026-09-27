import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { LeadSalesFieldsDto } from "./dto/lead-sales-fields.dto";

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
    const [leads, contacts] = await Promise.all([
      this.prisma.lead.findMany({
        where: { companyId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
      }),
      // Last outreach actually sent to each lead (email/WhatsApp), for the
      // "Last contacted" column.
      this.prisma.crmActivity.groupBy({
        by: ["leadId"],
        where: { companyId, leadId: { not: null }, sentAt: { not: null } },
        _max: { sentAt: true },
        _count: { _all: true },
      }),
    ]);
    const byLead = new Map(contacts.map((c) => [c.leadId, c]));
    return leads.map((l) => ({
      ...l,
      lastContactedAt: byLead.get(l.id)?._max.sentAt ?? null,
      messagesSent: byLead.get(l.id)?._count._all ?? 0,
    }));
  }

  /** Headline numbers for the Leads dashboard — pipeline, sources, outreach, trend. */
  async dashboard(companyId: string) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const endOfToday = new Date(now);
    endOfToday.setUTCHours(23, 59, 59, 999);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [leads, followUpsDue, sent, recent] = await Promise.all([
      this.prisma.lead.findMany({
        where: { companyId },
        select: { status: true, source: true, priority: true, businessLines: true, city: true, estimatedValue: true, createdAt: true },
      }),
      this.prisma.crmActivity.count({
        where: {
          companyId,
          sentAt: null,
          completedAt: null,
          dueDate: { lte: endOfToday },
          type: { in: ["EMAIL", "WHATSAPP"] },
          lead: { status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] } },
        },
      }),
      this.prisma.crmActivity.groupBy({
        by: ["type"],
        where: { companyId, sentAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
      this.prisma.crmActivity.findMany({
        where: { companyId, leadId: { not: null }, OR: [{ sentAt: { not: null } }, { completedAt: { not: null } }] },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          type: true,
          subject: true,
          sentAt: true,
          createdAt: true,
          lead: { select: { id: true, name: true, companyName: true } },
        },
      }),
    ]);

    const tally = <T extends string>(values: T[]) => {
      const m: Record<string, number> = {};
      for (const v of values) m[v] = (m[v] ?? 0) + 1;
      return m;
    };
    const monthly: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthly.push({ month: d.toISOString().slice(0, 7), count: 0 });
    }
    for (const l of leads) {
      if (l.createdAt < sixMonthsAgo) continue;
      const key = l.createdAt.toISOString().slice(0, 7);
      const bucket = monthly.find((m) => m.month === key);
      if (bucket) bucket.count++;
    }
    const topCities = Object.entries(tally(leads.map((l) => (l.city?.trim() || "Unspecified") as string)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([city, count]) => ({ city, count }));

    const total = leads.length;
    const converted = leads.filter((l) => l.status === LeadStatus.CONVERTED).length;
    const open = leads.filter((l) => l.status !== LeadStatus.CONVERTED && l.status !== LeadStatus.DISQUALIFIED);
    return {
      total,
      open: open.length,
      newThisMonth: leads.filter((l) => l.createdAt >= monthStart).length,
      newLastMonth: leads.filter((l) => l.createdAt >= lastMonthStart && l.createdAt < monthStart).length,
      conversionRate: total ? Math.round((converted / total) * 1000) / 10 : 0,
      pipelineValue: open.reduce((sum, l) => sum + Number(l.estimatedValue ?? 0), 0),
      followUpsDue,
      byStatus: tally(leads.map((l) => l.status)),
      bySource: tally(leads.map((l) => l.source)),
      byPriority: tally(open.map((l) => l.priority)),
      byService: tally(leads.flatMap((l) => l.businessLines)),
      topCities,
      monthly,
      sentLast30Days: Object.fromEntries(sent.map((s) => [s.type, s._count._all])),
      recentActivity: recent,
    };
  }

  /**
   * Deletes a lead and its activity history. Converted leads (and leads an
   * opportunity was raised from) stay, since the opportunity points at them.
   */
  async delete(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status === LeadStatus.CONVERTED || before.convertedOpportunityId) {
      throw new ConflictException("This lead was converted to an opportunity and can't be deleted — mark it Disqualified instead");
    }
    const linked = await this.prisma.opportunity.count({ where: { companyId, leadId: id } });
    if (linked > 0) {
      throw new ConflictException("An opportunity was raised from this lead, so it can't be deleted — mark it Disqualified instead");
    }
    await this.prisma.lead.delete({ where: { id } });
    await this.auditService.log({
      companyId,
      entityName: "Lead",
      entityId: id,
      action: "DELETE",
      changedByUserId: userId,
      beforeSnapshot: before,
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
        ...salesFields(dto),
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
        ...salesFields(dto),
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

function salesFields(dto: LeadSalesFieldsDto) {
  return {
    priority: dto.priority,
    businessLines: dto.businessLines,
    safetyCertsRequired: dto.safetyCertsRequired,
    contractorGrade: dto.contractorGrade,
    companyWebsite: dto.companyWebsite,
    projectName: dto.projectName,
    city: dto.city,
    estimatedValue: dto.estimatedValue === undefined ? undefined : dto.estimatedValue === "" ? null : dto.estimatedValue,
    followUpDate: dto.followUpDate === undefined ? undefined : new Date(dto.followUpDate),
  };
}
