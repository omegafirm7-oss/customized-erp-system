import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { CrmActivityType, Lead, LeadSource, LeadStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { MailService } from "../../common/mail/mail.service";
import { AuditService } from "../../audit/audit.service";
import { SalesAgentAiService, ResearchParams } from "./sales-agent-ai.service";
import { toWhatsAppNumber } from "./whatsapp-number";
import { UpdateAgentSettingsDto } from "./dto/update-agent-settings.dto";
import { DraftMessageDto } from "./dto/draft-message.dto";
import { SendEmailDto, LogWhatsAppDto } from "./dto/send-outreach.dto";
import { ImportLeadsDto } from "./dto/import-leads.dto";

// A lead that has moved past these statuses is no longer chased: pending
// follow-ups stop being listed as due and the auto-sender skips them.
const CHASEABLE_STATUSES: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED];
const AUTO_SEND_INTERVAL_MS = 5 * 60 * 1000;
const ASSET_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "application/pdf"];
const MAX_ASSETS = 20;

@Injectable()
export class OutreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly ai: SalesAgentAiService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit() {
    // Tests drive runAutoSendOnce() directly instead of a real timer.
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.runAutoSendOnce(), AUTO_SEND_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  status() {
    return { aiConfigured: this.ai.isConfigured(), emailConfigured: this.mail.isConfigured() };
  }

  // ── Settings ──────────────────────────────────────────────────────────

  async getSettings(companyId: string) {
    const existing = await this.prisma.crmAgentSettings.findUnique({ where: { companyId } });
    if (existing) return existing;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    // Not persisted until the user saves — an unsaved default costs nothing.
    return {
      id: null,
      companyId,
      companyProfile: `${companyDisplayName(company)} — describe your company here: services (e.g. TVTC-accredited safety training and TUV safety cards), accreditations, cities you cover, training centre location, batch schedule, pricing you are happy to quote, and contact phone/WhatsApp. The AI only states facts written here.`,
      emailSignature: null,
      replyToEmail: null,
      whatsappNumber: null,
      defaultLanguage: "en",
      followUpDays: "3,7",
      autoSendEmailFollowUps: false,
      updatedAt: null,
    };
  }

  async updateSettings(companyId: string, userId: string, dto: UpdateAgentSettingsDto) {
    const before = await this.prisma.crmAgentSettings.findUnique({ where: { companyId } });
    const data = {
      companyProfile: dto.companyProfile,
      emailSignature: dto.emailSignature,
      replyToEmail: dto.replyToEmail || null,
      whatsappNumber: dto.whatsappNumber,
      defaultLanguage: dto.defaultLanguage,
      followUpDays: dto.followUpDays !== undefined ? normalizeFollowUpDays(dto.followUpDays) : undefined,
      autoSendEmailFollowUps: dto.autoSendEmailFollowUps,
    };
    const saved = await this.prisma.crmAgentSettings.upsert({
      where: { companyId },
      create: {
        ...data,
        companyId,
        companyProfile: dto.companyProfile ?? (await this.getSettings(companyId)).companyProfile,
      },
      update: data,
    });
    await this.auditService.log({
      companyId,
      entityName: "CrmAgentSettings",
      entityId: saved.id,
      action: before ? "UPDATE" : "CREATE",
      changedByUserId: userId,
      beforeSnapshot: before ?? undefined,
      afterSnapshot: saved,
    });
    return saved;
  }

  // ── AI ────────────────────────────────────────────────────────────────

  async research(companyId: string, params: ResearchParams) {
    const settings = await this.getSettings(companyId);
    const existing = await this.prisma.lead.findMany({
      where: { companyId, companyName: { not: null } },
      select: { companyName: true },
    });
    const exclude = [...new Set([...(params.excludeCompanies ?? []), ...existing.map((l) => l.companyName!)])];
    const leads = await this.ai.researchLeads(settings.companyProfile, { ...params, excludeCompanies: exclude });
    return { leads };
  }

  async importLeads(companyId: string, userId: string, dto: ImportLeadsDto) {
    const created: Lead[] = [];
    for (const l of dto.leads) {
      const clean = (v?: string) => (v && !/^not listed$/i.test(v.trim()) ? v.trim() : undefined);
      const email = clean(l.email);
      const lead = await this.prisma.lead.create({
        data: {
          companyId,
          name: l.companyName,
          companyName: l.companyName,
          email: email && /^\S+@\S+\.\S+$/.test(email) ? email : undefined,
          phone: clean(l.phone),
          companyWebsite: clean(l.website),
          city: clean(l.location) ?? dto.city,
          source: LeadSource.AI_RESEARCH,
          priority: l.confidence === "HIGH" ? "HOT" : "WARM",
          businessLines: dto.businessLines ?? [],
          aiRationale: [l.whyTheyNeedUs, l.howToReach && `How to reach: ${l.howToReach}`].filter(Boolean).join("\n") || undefined,
          aiConfidence: l.confidence,
          notes: [l.activity, l.notes].filter(Boolean).join("\n") || undefined,
          ownerUserId: userId,
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
      created.push(lead);
    }
    return { created: created.length, leads: created };
  }

  async draft(companyId: string, userId: string, dto: DraftMessageDto) {
    const lead = await this.getLead(companyId, dto.leadId);
    const [settings, company, user, history] = await Promise.all([
      this.getSettings(companyId),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      this.sentHistory(companyId, lead.id),
    ]);
    const purpose = dto.purpose ?? (history.length > 0 ? "FOLLOW_UP" : "INTRO");
    return this.ai.draftMessage({
      channel: dto.channel,
      purpose,
      language: dto.language ?? (settings.defaultLanguage as "en" | "ar" | "both"),
      companyName: companyDisplayName(company),
      companyProfile: settings.companyProfile,
      senderName: user?.fullName ?? companyDisplayName(company),
      lead,
      previousMessages: history,
      extraInstructions: dto.extraInstructions,
    });
  }

  // ── Sending ───────────────────────────────────────────────────────────

  async sendEmail(companyId: string, userId: string, dto: SendEmailDto) {
    const lead = await this.getLead(companyId, dto.leadId);
    const to = dto.to ?? lead.email;
    if (!to) throw new BadRequestException("This lead has no email address");
    const [settings, company] = await Promise.all([
      this.getSettings(companyId),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    ]);
    const text = withSignature(dto.body, settings.emailSignature);
    const files = await this.loadAssets(companyId, dto.assetIds ?? []);
    try {
      await this.mail.sendOutreachEmail({
        to,
        subject: dto.subject,
        text,
        senderName: companyDisplayName(company),
        replyTo: settings.replyToEmail,
        files,
      });
    } catch (err) {
      this.logger.warn(`Outreach email to ${to} failed: ${(err as Error).message}`);
      throw new BadRequestException(`Email could not be sent: ${(err as Error).message}`);
    }
    return this.recordSent(companyId, userId, lead, {
      type: CrmActivityType.EMAIL,
      subject: dto.subject,
      body: text,
      recipient: to,
      attachmentNames: files.map((f) => f.fileName),
      followUpActivityId: dto.followUpActivityId,
      scheduleFollowUps: dto.scheduleFollowUps,
      followUpDays: settings.followUpDays,
      autoSend: settings.autoSendEmailFollowUps,
    });
  }

  // ── Marketing flyers ──────────────────────────────────────────────────

  listAssets(companyId: string) {
    return this.prisma.crmMarketingAsset.findMany({
      where: { companyId },
      select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async uploadAsset(companyId: string, userId: string, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    if (!ASSET_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException("Flyers must be JPEG, PNG, GIF or PDF");
    }
    const count = await this.prisma.crmMarketingAsset.count({ where: { companyId } });
    if (count >= MAX_ASSETS) throw new BadRequestException(`You can keep up to ${MAX_ASSETS} flyers — delete one first`);
    const asset = await this.prisma.crmMarketingAsset.create({
      data: {
        companyId,
        fileName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        size: file.buffer.length,
        data: file.buffer,
        createdByUserId: userId,
      },
      select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
    });
    await this.auditService.log({
      companyId,
      entityName: "CrmMarketingAsset",
      entityId: asset.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: asset,
    });
    return asset;
  }

  async getAssetFile(companyId: string, id: string) {
    const asset = await this.prisma.crmMarketingAsset.findFirst({ where: { id, companyId } });
    if (!asset) throw new NotFoundException("Flyer not found");
    return asset;
  }

  async deleteAsset(companyId: string, userId: string, id: string) {
    const asset = await this.prisma.crmMarketingAsset.findFirst({
      where: { id, companyId },
      select: { id: true, fileName: true, mimeType: true, size: true },
    });
    if (!asset) throw new NotFoundException("Flyer not found");
    await this.prisma.crmMarketingAsset.delete({ where: { id } });
    await this.auditService.log({
      companyId,
      entityName: "CrmMarketingAsset",
      entityId: id,
      action: "DELETE",
      changedByUserId: userId,
      beforeSnapshot: asset,
    });
  }

  private async loadAssets(companyId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const assets = await this.prisma.crmMarketingAsset.findMany({ where: { companyId, id: { in: ids } } });
    if (assets.length !== new Set(ids).size) throw new BadRequestException("One of the selected flyers no longer exists");
    // Keep the order the user picked them in.
    return ids.map((id) => assets.find((a) => a.id === id)!).map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, data: Buffer.from(a.data) }));
  }

  /** WhatsApp is click-to-send: the browser opened wa.me with the text; this records it. */
  async logWhatsApp(companyId: string, userId: string, dto: LogWhatsAppDto) {
    const lead = await this.getLead(companyId, dto.leadId);
    const number = toWhatsAppNumber(dto.to ?? lead.phone);
    if (!number) throw new BadRequestException("This lead has no usable phone number for WhatsApp");
    const settings = await this.getSettings(companyId);
    return this.recordSent(companyId, userId, lead, {
      type: CrmActivityType.WHATSAPP,
      subject: "WhatsApp message",
      body: dto.body,
      recipient: number,
      followUpActivityId: dto.followUpActivityId,
      scheduleFollowUps: dto.scheduleFollowUps,
      followUpDays: settings.followUpDays,
      autoSend: false,
    });
  }

  /** Pending follow-ups for leads still being chased, oldest due first. */
  async listFollowUps(companyId: string) {
    return this.prisma.crmActivity.findMany({
      where: {
        companyId,
        type: { in: [CrmActivityType.EMAIL, CrmActivityType.WHATSAPP] },
        sentAt: null,
        completedAt: null,
        dueDate: { not: null },
        lead: { status: { in: CHASEABLE_STATUSES } },
      },
      include: {
        lead: { select: { id: true, name: true, companyName: true, email: true, phone: true, status: true, priority: true } },
      },
      orderBy: { dueDate: "asc" },
    });
  }

  /**
   * Delivers due auto-send EMAIL follow-ups. Each one is claimed with a
   * conditional update first so an overlapping run can never send twice;
   * a failure turns auto-send off and leaves it in the due list for a human.
   */
  async runAutoSendOnce(now = new Date()): Promise<number> {
    if (this.running || !this.mail.isConfigured()) return 0;
    this.running = true;
    let sent = 0;
    try {
      const due = await this.prisma.crmActivity.findMany({
        where: {
          autoSend: true,
          sentAt: null,
          completedAt: null,
          dueDate: { lte: now },
          type: CrmActivityType.EMAIL,
          lead: { status: { in: CHASEABLE_STATUSES } },
        },
        include: { lead: true },
        take: 50,
      });
      for (const activity of due) {
        const claimed = await this.prisma.crmActivity.updateMany({
          where: { id: activity.id, sentAt: null, completedAt: null },
          data: { completedAt: now },
        });
        if (claimed.count === 0 || !activity.lead) continue;
        try {
          await this.autoSendOne(activity.companyId, activity.id, activity.lead, activity.createdByUserId, activity.subject);
          sent++;
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          this.logger.warn(`Auto follow-up ${activity.id} failed: ${message}`);
          await this.prisma.crmActivity.update({
            where: { id: activity.id },
            data: { completedAt: null, autoSend: false, sendError: message.slice(0, 500) },
          });
        }
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  private async autoSendOne(companyId: string, activityId: string, lead: Lead, userId: string, label: string) {
    if (!lead.email) throw new Error("Lead has no email address");
    const [settings, company, history] = await Promise.all([
      this.getSettings(companyId),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.sentHistory(companyId, lead.id),
    ]);
    const lastEmail = history.filter((h) => h.channel === CrmActivityType.EMAIL).at(-1);
    let subject: string;
    let body: string;
    if (this.ai.isConfigured()) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
      const draft = await this.ai.draftMessage({
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        language: settings.defaultLanguage as "en" | "ar" | "both",
        companyName: companyDisplayName(company),
        companyProfile: settings.companyProfile,
        senderName: user?.fullName ?? companyDisplayName(company),
        lead,
        previousMessages: history,
      });
      subject = draft.subject;
      body = draft.body;
    } else {
      subject = lastEmail?.subject ? `Re: ${lastEmail.subject.replace(/^Re:\s*/i, "")}` : "Following up";
      body = `Dear ${lead.name},\n\nI'm following up on my earlier message in case it got buried. We would be glad to help with your team's safety training and TUV cards — just reply to this email and we will share the next available batch dates and a quote.`;
    }
    const text = withSignature(body, settings.emailSignature);
    await this.mail.sendOutreachEmail({
      to: lead.email,
      subject,
      text,
      senderName: companyDisplayName(company),
      replyTo: settings.replyToEmail,
    });
    await this.prisma.crmActivity.update({
      where: { id: activityId },
      data: { sentAt: new Date(), messageSubject: subject, messageBody: text, recipient: lead.email, sendError: null },
    });
    await this.refreshFollowUpDate(companyId, lead.id);
    this.logger.log(`Auto follow-up "${label}" sent to lead ${lead.id}`);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async recordSent(
    companyId: string,
    userId: string,
    lead: Lead,
    p: {
      type: CrmActivityType;
      subject: string;
      body: string;
      recipient: string;
      attachmentNames?: string[];
      followUpActivityId?: string;
      scheduleFollowUps?: boolean;
      followUpDays: string;
      autoSend: boolean;
    },
  ) {
    const now = new Date();
    const activity = await this.prisma.$transaction(async (tx) => {
      let sent;
      if (p.followUpActivityId) {
        // Sending a scheduled follow-up: complete that activity in place.
        const pending = await tx.crmActivity.findFirst({
          where: { id: p.followUpActivityId, companyId, leadId: lead.id, sentAt: null },
        });
        if (!pending) throw new ConflictException("That follow-up was already sent or no longer exists");
        sent = await tx.crmActivity.update({
          where: { id: pending.id },
          data: {
            type: p.type,
            messageSubject: p.subject,
            messageBody: p.body,
            recipient: p.recipient,
            attachmentNames: p.attachmentNames ?? [],
            sentAt: now,
            completedAt: now,
            autoSend: false,
            sendError: null,
          },
        });
      } else {
        sent = await tx.crmActivity.create({
          data: {
            companyId,
            leadId: lead.id,
            type: p.type,
            subject: p.subject,
            messageSubject: p.type === CrmActivityType.EMAIL ? p.subject : null,
            messageBody: p.body,
            recipient: p.recipient,
            attachmentNames: p.attachmentNames ?? [],
            sentAt: now,
            completedAt: now,
            ownerUserId: userId,
            createdByUserId: userId,
          },
        });
      }
      if (p.scheduleFollowUps) {
        const days = parseFollowUpDays(p.followUpDays);
        // Re-scheduling replaces any follow-ups still pending for this lead.
        await tx.crmActivity.deleteMany({ where: { companyId, leadId: lead.id, sentAt: null, completedAt: null, dueDate: { not: null }, type: { in: [CrmActivityType.EMAIL, CrmActivityType.WHATSAPP] } } });
        for (const [i, d] of days.entries()) {
          await tx.crmActivity.create({
            data: {
              companyId,
              leadId: lead.id,
              type: p.type,
              subject: `Follow-up #${i + 1} (day ${d})`,
              dueDate: new Date(now.getTime() + d * 86_400_000),
              autoSend: p.type === CrmActivityType.EMAIL && p.autoSend,
              ownerUserId: userId,
              createdByUserId: userId,
            },
          });
        }
      }
      if (lead.status === LeadStatus.NEW) {
        await tx.lead.update({ where: { id: lead.id }, data: { status: LeadStatus.CONTACTED } });
      }
      return sent;
    });
    await this.refreshFollowUpDate(companyId, lead.id);
    await this.auditService.log({
      companyId,
      entityName: "CrmActivity",
      entityId: activity.id,
      action: p.followUpActivityId ? "UPDATE" : "CREATE",
      changedByUserId: userId,
      afterSnapshot: activity,
    });
    return activity;
  }

  /** Keeps Lead.followUpDate pointing at the next pending follow-up (or clears it). */
  private async refreshFollowUpDate(companyId: string, leadId: string) {
    const next = await this.prisma.crmActivity.findFirst({
      where: { companyId, leadId, sentAt: null, completedAt: null, dueDate: { not: null } },
      orderBy: { dueDate: "asc" },
      select: { dueDate: true },
    });
    await this.prisma.lead.update({ where: { id: leadId }, data: { followUpDate: next?.dueDate ?? null } });
  }

  private async sentHistory(companyId: string, leadId: string) {
    const sent = await this.prisma.crmActivity.findMany({
      where: { companyId, leadId, sentAt: { not: null }, messageBody: { not: null } },
      orderBy: { sentAt: "asc" },
      take: 10,
    });
    return sent.map((a) => ({ channel: a.type, sentAt: a.sentAt, subject: a.messageSubject, body: a.messageBody! }));
  }

  private async getLead(companyId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }
}

function companyDisplayName(company: { legalName: string; tradeName: string | null }) {
  return company.tradeName || company.legalName;
}

function withSignature(body: string, signature: string | null) {
  return signature ? `${body.trimEnd()}\n\n${signature.trim()}` : body;
}

function parseFollowUpDays(value: string): number[] {
  return value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 90)
    .slice(0, 5);
}

function normalizeFollowUpDays(value: string): string {
  const days = [...new Set(parseFollowUpDays(value))].sort((a, b) => a - b);
  if (value.trim() !== "" && days.length === 0) {
    throw new BadRequestException("Follow-up days must be whole numbers between 1 and 90, e.g. 3,7");
  }
  return days.join(",");
}

