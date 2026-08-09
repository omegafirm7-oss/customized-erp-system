import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpdateTemplateSettingsDto } from "./dto/template-settings.dtos";

@Injectable()
export class TemplateSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Upserts a default row on first read — every company gets one lazily, no explicit provisioning step needed. */
  async get(companyId: string) {
    const existing = await this.prisma.templateSettings.findUnique({ where: { companyId } });
    if (existing) {
      const { logo, ...rest } = existing;
      return { ...rest, hasLogo: logo !== null };
    }
    const created = await this.prisma.templateSettings.create({ data: { companyId } });
    const { logo, ...rest } = created;
    return { ...rest, hasLogo: logo !== null };
  }

  async update(companyId: string, userId: string, dto: UpdateTemplateSettingsDto) {
    await this.get(companyId); // ensures a row exists
    const before = await this.prisma.templateSettings.findUnique({ where: { companyId } });
    const updated = await this.prisma.templateSettings.update({
      where: { companyId },
      data: { ...dto, updatedByUserId: userId },
    });

    await this.auditService.log({
      companyId,
      entityName: "TemplateSettings",
      entityId: updated.id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });

    const { logo, ...rest } = updated;
    return { ...rest, hasLogo: logo !== null };
  }

  async setLogo(companyId: string, userId: string, buffer: Buffer, mimeType: string) {
    await this.get(companyId);
    await this.prisma.templateSettings.update({
      where: { companyId },
      data: { logo: buffer, logoMimeType: mimeType, updatedByUserId: userId },
    });
    return { ok: true };
  }

  async getLogo(companyId: string) {
    const row = await this.prisma.templateSettings.findUnique({ where: { companyId } });
    if (!row?.logo || !row.logoMimeType) {
      throw new NotFoundException("No logo saved for this company");
    }
    return { data: row.logo, mimeType: row.logoMimeType };
  }

  async removeLogo(companyId: string, userId: string) {
    await this.get(companyId);
    await this.prisma.templateSettings.update({
      where: { companyId },
      data: { logo: null, logoMimeType: null, updatedByUserId: userId },
    });
    return { ok: true };
  }
}
