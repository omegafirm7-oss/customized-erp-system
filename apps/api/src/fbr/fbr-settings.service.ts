import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FbrEnvironment, FbrRegistrationType, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AppConfig } from "../core/config/configuration";
import { decryptSecret, encryptSecret } from "../zatca/crypto/key-encryption";
import { FbrApiClient } from "./fbr-api.client";
import { UpdateFbrSettingsDto } from "./dto/fbr.dto";

@Injectable()
export class FbrSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly apiClient: FbrApiClient,
    private readonly auditService: AuditService,
  ) {}

  /** Settings with tokens redacted to presence flags. */
  async get(companyId: string) {
    const settings = await this.prisma.fbrSettings.findUnique({ where: { companyId } });
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { countryCode: true, ntn: true, strn: true, province: true, fbrBusinessActivity: true, fbrSector: true },
    });
    return {
      company,
      enabled: settings?.enabled ?? false,
      environment: settings?.environment ?? FbrEnvironment.MOCK,
      hasDiToken: !!settings?.diTokenEnc,
      hasPosToken: !!settings?.posTokenEnc,
      furtherTaxRatePercent: settings?.furtherTaxRatePercent.toString() ?? "4",
      posFeeAmount: settings?.posFeeAmount.toString() ?? "1",
      servicesTaxRatePercent: settings?.servicesTaxRatePercent.toString() ?? "15",
      posFeeAccountId: settings?.posFeeAccountId ?? null,
    };
  }

  async update(companyId: string, userId: string, dto: UpdateFbrSettingsDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.countryCode !== "PK") {
      throw new ConflictException("FBR reporting is only available for Pakistan (PK) companies");
    }
    const existing = await this.prisma.fbrSettings.findUnique({ where: { companyId } });
    const encryptionKey = this.configService.get("zatca", { infer: true }).encryptionKey;

    const data: Prisma.FbrSettingsUncheckedCreateInput = { companyId };
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.environment !== undefined) data.environment = dto.environment;
    if (dto.furtherTaxRatePercent !== undefined) data.furtherTaxRatePercent = new Prisma.Decimal(dto.furtherTaxRatePercent);
    if (dto.posFeeAmount !== undefined) data.posFeeAmount = new Prisma.Decimal(dto.posFeeAmount);
    if (dto.servicesTaxRatePercent !== undefined) {
      const rate = new Prisma.Decimal(dto.servicesTaxRatePercent);
      if (rate.lte(0) || rate.gt(30)) throw new BadRequestException("Services tax rate must be between 0 and 30%");
      data.servicesTaxRatePercent = rate;
    }
    if (dto.posFeeAccountId !== undefined) {
      if (dto.posFeeAccountId) {
        const account = await this.prisma.account.findFirst({ where: { id: dto.posFeeAccountId, companyId, isPostable: true } });
        if (!account) throw new BadRequestException("POS fee account must be a postable account of this company");
      }
      data.posFeeAccountId = dto.posFeeAccountId || null;
    }
    for (const [field, value] of [["diTokenEnc", dto.diToken], ["posTokenEnc", dto.posToken]] as const) {
      if (value === undefined) continue;
      if (value && !encryptionKey) {
        throw new ConflictException("Server has no ZATCA_KEY_ENCRYPTION_KEY configured — cannot store FBR tokens securely");
      }
      data[field] = value ? encryptSecret(value.trim(), encryptionKey) : null;
    }

    const next = {
      enabled: data.enabled ?? existing?.enabled ?? false,
      environment: data.environment ?? existing?.environment ?? FbrEnvironment.MOCK,
      diTokenEnc: data.diTokenEnc !== undefined ? data.diTokenEnc : existing?.diTokenEnc,
    };
    if (next.enabled) {
      const missing = [
        !company.ntn && "NTN",
        !company.province && "province",
        !company.fbrBusinessActivity && "business activity",
      ].filter(Boolean);
      if (missing.length) {
        throw new BadRequestException(`Set the company's ${missing.join(", ")} before enabling FBR reporting`);
      }
      if (next.environment !== FbrEnvironment.MOCK && !next.diTokenEnc) {
        throw new BadRequestException(`Enter the ${next.environment.toLowerCase()} Digital Invoicing token before enabling`);
      }
    }

    const { companyId: _omit, ...updateData } = data;
    const saved = await this.prisma.fbrSettings.upsert({ where: { companyId }, create: data, update: updateData });
    await this.auditService.log({
      companyId,
      entityName: "FbrSettings",
      entityId: saved.id,
      action: existing ? "UPDATE" : "CREATE",
      changedByUserId: userId,
      // Never log tokens, even encrypted.
      afterSnapshot: {
        enabled: saved.enabled,
        environment: saved.environment,
        furtherTaxRatePercent: saved.furtherTaxRatePercent,
        posFeeAmount: saved.posFeeAmount,
        servicesTaxRatePercent: saved.servicesTaxRatePercent,
        diTokenChanged: dto.diToken !== undefined,
        posTokenChanged: dto.posToken !== undefined,
      },
    });
    return this.get(companyId);
  }

  /** Round-trips the provinces reference API to prove the DI token works. */
  async testConnection(companyId: string) {
    const settings = await this.requireSettings(companyId);
    const result = await this.apiClient.getReference(settings.environment, this.diToken(settings), "/pdi/v1/provinces");
    if (!Array.isArray(result)) {
      return { ok: false, environment: settings.environment, message: "FBR did not accept the token (or is unreachable)" };
    }
    return { ok: true, environment: settings.environment, message: `Connected — ${result.length} provinces returned`, provinces: result };
  }

  /** Looks up a partner's NTN/CNIC with FBR and stores the registration type. */
  async checkPartnerRegistration(companyId: string, partnerId: string) {
    const settings = await this.requireSettings(companyId);
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId } });
    if (!partner) throw new NotFoundException("Business partner not found");
    if (!partner.ntnCnic) throw new BadRequestException("Partner has no NTN/CNIC to check");
    const type = await this.apiClient.getRegistrationType(settings.environment, this.diToken(settings), partner.ntnCnic);
    if (!type) throw new ConflictException("FBR did not return a registration status — try again later");
    return this.prisma.businessPartner.update({
      where: { id: partner.id },
      data: {
        fbrRegistrationType: type === "Registered" ? FbrRegistrationType.REGISTERED : FbrRegistrationType.UNREGISTERED,
        fbrRegistrationCheckedAt: new Date(),
      },
    });
  }

  private async requireSettings(companyId: string) {
    const settings = await this.prisma.fbrSettings.findUnique({ where: { companyId } });
    if (!settings) throw new ConflictException("Configure FBR settings first");
    return settings;
  }

  private diToken(settings: { diTokenEnc: string | null; environment: FbrEnvironment }) {
    if (settings.environment === FbrEnvironment.MOCK || !settings.diTokenEnc) return null;
    return decryptSecret(settings.diTokenEnc, this.configService.get("zatca", { infer: true }).encryptionKey);
  }
}
