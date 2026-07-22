import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ZatcaDeviceStatus, ZatcaEnvironment } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ZatcaApiClient, CsidCredentials } from "./zatca-api.client";
import { generateCsr, parseCertificate } from "./crypto/csr";
import { encryptSecret, decryptSecret } from "./crypto/key-encryption";
import { signInvoice, embedQrInXml } from "./crypto/xades";
import { buildQrPayload } from "./crypto/tlv";
import { buildUblInvoiceXml } from "./ubl/ubl-builder";
import { UblSeller } from "./ubl/ubl-types";
import { PIH_SEED, computeInvoiceHash } from "./crypto/invoice-hash";
import { COMPLIANCE_SAMPLE_SPECS, buildComplianceSampleInput } from "./compliance-samples";
import { AppConfig } from "../core/config/configuration";

@Injectable()
export class ZatcaDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly apiClient: ZatcaApiClient,
    private readonly auditService: AuditService,
  ) {}

  private encryptionKey(): string {
    const key = this.configService.get("zatca", { infer: true }).encryptionKey;
    if (!key) {
      throw new BadRequestException("ZATCA_KEY_ENCRYPTION_KEY is not configured on the server");
    }
    return key;
  }

  /** Builds the UBL seller block from company master data, refusing when
   * ZATCA-mandatory fields are missing — clearer than a ZATCA 400 later.
   * Callers already inside a transaction MUST pass their tx client: querying
   * the global client from within a tx grabs a second pool connection and
   * can deadlock the pool under concurrent posting. */
  async getSellerOrThrow(companyId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<UblSeller> {
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const missing: string[] = [];
    if (!company.taxRegistrationNumber || !/^3\d{13}3$/.test(company.taxRegistrationNumber)) {
      missing.push("taxRegistrationNumber (15 digits, starting and ending with 3)");
    }
    if (!company.crNumber) missing.push("crNumber");
    if (!company.addressLine1) missing.push("addressLine1 (street)");
    if (!company.buildingNumber) missing.push("buildingNumber");
    if (!company.district) missing.push("district");
    if (!company.city) missing.push("city");
    if (!company.postalCode || !/^\d{5}$/.test(company.postalCode)) missing.push("postalCode (5 digits)");
    if (missing.length > 0) {
      throw new BadRequestException(`Company master data incomplete for ZATCA: ${missing.join(", ")}`);
    }
    return {
      legalName: company.legalName,
      vatNumber: company.taxRegistrationNumber!,
      crNumber: company.crNumber,
      streetName: company.addressLine1!,
      buildingNumber: company.buildingNumber!,
      district: company.district!,
      city: company.city!,
      postalCode: company.postalCode!,
      countryCode: company.countryCode,
    };
  }

  async createDevice(
    companyId: string,
    userId: string,
    input: { environment: ZatcaEnvironment; unitName: string; otp?: string },
  ) {
    const seller = await this.getSellerOrThrow(companyId);

    const existing = await this.prisma.zatcaDevice.findUnique({
      where: { companyId_environment: { companyId, environment: input.environment } },
    });
    if (existing && existing.status !== ZatcaDeviceStatus.FAILED && existing.status !== ZatcaDeviceStatus.REVOKED) {
      throw new ConflictException(`A ${input.environment} device already exists (status ${existing.status})`);
    }

    const key = this.encryptionKey();
    const csr = generateCsr({
      environment: input.environment,
      unitName: input.unitName,
      organizationName: seller.legalName,
      organizationUnit: seller.city,
      vatNumber: seller.vatNumber,
      registeredAddress: `${seller.city}`,
      businessCategory: "Technology",
      solutionName: "ERP",
      solutionVersion: "1.0",
    });

    const otp = input.otp ?? "123345"; // sandbox accepts any OTP
    const csidResult = await this.apiClient.requestComplianceCsid(input.environment, csr.csrBase64, otp);

    const baseData = {
      companyId,
      environment: input.environment,
      unitName: input.unitName,
      egsSerialNumber: csr.egsSerialNumber,
      privateKeyEnc: encryptSecret(csr.privateKeyPem, key),
      csrPem: csr.csrPem,
      createdByUserId: userId,
    };

    let device;
    if (csidResult.outcome === "ACCEPTED" || csidResult.outcome === "ACCEPTED_WITH_WARNINGS") {
      const body = csidResult.body as { requestID?: unknown; binarySecurityToken?: string; secret?: string };
      if (!body?.binarySecurityToken || !body?.secret) {
        throw new BadRequestException("ZATCA compliance CSID response missing credentials");
      }
      device = await this.upsertDevice(companyId, input.environment, {
        ...baseData,
        complianceRequestId: String(body.requestID ?? ""),
        complianceCsid: body.binarySecurityToken,
        complianceSecretEnc: encryptSecret(body.secret, key),
        status: ZatcaDeviceStatus.COMPLIANCE_CSID_ISSUED,
        failureReason: null,
      });
    } else {
      device = await this.upsertDevice(companyId, input.environment, {
        ...baseData,
        status: ZatcaDeviceStatus.FAILED,
        failureReason: `Compliance CSID request failed (${csidResult.outcome}): ${JSON.stringify(csidResult.body ?? csidResult.errorMessage)}`,
      });
    }

    await this.auditService.log({
      companyId,
      entityName: "ZatcaDevice",
      entityId: device.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: this.redact(device),
    });

    return this.redact(device);
  }

  /** Runs the six onboarding compliance-check submissions with the CCSID. */
  async runComplianceChecks(companyId: string, deviceId: string, userId: string) {
    const device = await this.getOwnedDevice(companyId, deviceId);
    if (device.status !== ZatcaDeviceStatus.COMPLIANCE_CSID_ISSUED) {
      throw new ConflictException(`Device must be in COMPLIANCE_CSID_ISSUED status (is ${device.status})`);
    }
    const key = this.encryptionKey();
    const seller = await this.getSellerOrThrow(companyId);
    const credentials: CsidCredentials = {
      binarySecurityToken: device.complianceCsid!,
      secret: decryptSecret(device.complianceSecretEnc!, key),
    };
    const privateKeyPem = decryptSecret(device.privateKeyEnc, key);

    const results: Array<{ label: string; outcome: string; detail?: unknown }> = [];
    let pih = PIH_SEED;
    let icv = 0;

    for (const spec of COMPLIANCE_SAMPLE_SPECS) {
      icv += 1;
      const input = buildComplianceSampleInput(spec, seller, icv, pih);
      const unsignedXml = buildUblInvoiceXml(input);
      const signed = signInvoice({
        unsignedXml,
        certificateBase64: device.complianceCsid!,
        privateKeyPem,
      });
      pih = signed.invoiceHash;

      // Simplified documents must carry the QR (KSA-14 / BR-KSA-27) inside
      // the XML even at compliance-check time — same as real submissions.
      let submittedXml = signed.signedXml;
      if (spec.kind === "SIMPLIFIED") {
        const qr = buildQrPayload({
          sellerName: seller.legalName,
          sellerVatNumber: seller.vatNumber,
          // Must equal IssueDate + "T" + IssueTime exactly (KSA-25) — no
          // timezone suffix, since cbc:IssueTime carries none.
          timestamp: `${input.issueDate}T${input.issueTime}`,
          invoiceTotal: input.grossTotal,
          vatTotal: input.vatTotal,
          invoiceHash: signed.invoiceHash,
          // Tag 7 is the signature as its BASE64 STRING (must textually match
          // ds:SignatureValue), not the decoded DER bytes.
          signature: Buffer.from(signed.signatureBase64, "utf8"),
          publicKey: signed.parsedCertificate.publicKeyDer,
          certificateSignature: signed.parsedCertificate.signatureBytes,
        });
        submittedXml = embedQrInXml(submittedXml, qr);
      }

      const result = await this.apiClient.complianceCheck(device.environment, credentials, {
        invoiceHash: signed.invoiceHash,
        uuid: input.uuid,
        invoice: Buffer.from(submittedXml, "utf8").toString("base64"),
      });

      results.push({ label: spec.label, outcome: result.outcome, detail: result.body ?? result.errorMessage });
      if (result.outcome === "REJECTED" || result.outcome === "AUTH_FAILED" || result.outcome === "TRANSIENT_FAILURE") {
        await this.prisma.zatcaDevice.update({
          where: { id: deviceId },
          data: {
            status: ZatcaDeviceStatus.FAILED,
            failureReason: `Compliance check '${spec.label}' failed (${result.outcome}): ${JSON.stringify(result.body ?? result.errorMessage)}`,
          },
        });
        return { passed: false, results };
      }
    }

    const updated = await this.prisma.zatcaDevice.update({
      where: { id: deviceId },
      data: { status: ZatcaDeviceStatus.COMPLIANCE_CHECKED, failureReason: null },
    });

    await this.auditService.log({
      companyId,
      entityName: "ZatcaDevice",
      entityId: deviceId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: updated.status, complianceResults: results },
    });

    return { passed: true, results };
  }

  /** Exchanges the compliance request for a production CSID → ACTIVE. */
  async activate(companyId: string, deviceId: string, userId: string) {
    const device = await this.getOwnedDevice(companyId, deviceId);
    if (device.status !== ZatcaDeviceStatus.COMPLIANCE_CHECKED) {
      throw new ConflictException(`Device must be in COMPLIANCE_CHECKED status (is ${device.status})`);
    }
    const key = this.encryptionKey();
    const credentials: CsidCredentials = {
      binarySecurityToken: device.complianceCsid!,
      secret: decryptSecret(device.complianceSecretEnc!, key),
    };

    const result = await this.apiClient.requestProductionCsid(
      device.environment,
      credentials,
      device.complianceRequestId!,
    );

    if (result.outcome !== "ACCEPTED" && result.outcome !== "ACCEPTED_WITH_WARNINGS") {
      await this.prisma.zatcaDevice.update({
        where: { id: deviceId },
        data: {
          status: ZatcaDeviceStatus.FAILED,
          failureReason: `Production CSID request failed (${result.outcome}): ${JSON.stringify(result.body ?? result.errorMessage)}`,
        },
      });
      throw new BadRequestException("Production CSID request failed — see device failureReason");
    }

    const body = result.body as { binarySecurityToken?: string; secret?: string };
    if (!body?.binarySecurityToken || !body?.secret) {
      throw new BadRequestException("ZATCA production CSID response missing credentials");
    }

    let certificateExpiresAt: Date | null = null;
    try {
      certificateExpiresAt = parseCertificate(body.binarySecurityToken).notAfter;
    } catch {
      certificateExpiresAt = null;
    }

    const updated = await this.prisma.zatcaDevice.update({
      where: { id: deviceId },
      data: {
        productionCsid: body.binarySecurityToken,
        productionSecretEnc: encryptSecret(body.secret, key),
        certificateExpiresAt,
        status: ZatcaDeviceStatus.ACTIVE,
        onboardedAt: new Date(),
        failureReason: null,
      },
    });

    await this.auditService.log({
      companyId,
      entityName: "ZatcaDevice",
      entityId: deviceId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: this.redact(updated),
    });

    return this.redact(updated);
  }

  /** One-shot orchestrator: create (if needed) → checks → activate. */
  async onboard(
    companyId: string,
    userId: string,
    input: { environment: ZatcaEnvironment; unitName: string; otp?: string },
  ) {
    let device = await this.prisma.zatcaDevice.findUnique({
      where: { companyId_environment: { companyId, environment: input.environment } },
    });

    if (!device || device.status === ZatcaDeviceStatus.FAILED || device.status === ZatcaDeviceStatus.REVOKED) {
      await this.createDevice(companyId, userId, input);
      device = await this.prisma.zatcaDevice.findUniqueOrThrow({
        where: { companyId_environment: { companyId, environment: input.environment } },
      });
    }

    if (device.status === ZatcaDeviceStatus.COMPLIANCE_CSID_ISSUED) {
      const checks = await this.runComplianceChecks(companyId, device.id, userId);
      if (!checks.passed) {
        return { device: await this.getDevice(companyId, device.id), complianceResults: checks.results };
      }
    }

    const refreshed = await this.getOwnedDevice(companyId, device.id);
    if (refreshed.status === ZatcaDeviceStatus.COMPLIANCE_CHECKED) {
      await this.activate(companyId, device.id, userId);
    }

    return { device: await this.getDevice(companyId, device.id) };
  }

  async listDevices(companyId: string) {
    const devices = await this.prisma.zatcaDevice.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
    return devices.map((d) => this.redact(d));
  }

  async getDevice(companyId: string, deviceId: string) {
    return this.redact(await this.getOwnedDevice(companyId, deviceId));
  }

  /** Loads the ACTIVE device for a company (if any) with decrypted signing
   * material — internal use by the submission service only. */
  async getActiveSigningContext(companyId: string) {
    const device = await this.prisma.zatcaDevice.findFirst({
      where: { companyId, status: ZatcaDeviceStatus.ACTIVE },
      orderBy: { onboardedAt: "desc" },
    });
    if (!device) return null;
    const key = this.encryptionKey();
    return {
      device,
      privateKeyPem: decryptSecret(device.privateKeyEnc, key),
      credentials: {
        binarySecurityToken: device.productionCsid!,
        secret: decryptSecret(device.productionSecretEnc!, key),
      } satisfies CsidCredentials,
    };
  }

  private async upsertDevice(companyId: string, environment: ZatcaEnvironment, data: Record<string, unknown>) {
    return this.prisma.zatcaDevice.upsert({
      where: { companyId_environment: { companyId, environment } },
      update: {
        ...data,
        complianceRequestId: (data.complianceRequestId as string) ?? null,
        complianceCsid: (data.complianceCsid as string) ?? null,
        complianceSecretEnc: (data.complianceSecretEnc as string) ?? null,
        productionCsid: null,
        productionSecretEnc: null,
        certificateExpiresAt: null,
        onboardedAt: null,
        icvCounter: 0,
        lastInvoiceHash: PIH_SEED,
      } as never,
      create: data as never,
    });
  }

  private async getOwnedDevice(companyId: string, deviceId: string) {
    const device = await this.prisma.zatcaDevice.findFirst({ where: { id: deviceId, companyId } });
    if (!device) {
      throw new NotFoundException("ZATCA device not found");
    }
    return device;
  }

  /** Strips key material and secrets from API responses. */
  private redact<T extends Record<string, unknown>>(device: T): Omit<T, "privateKeyEnc" | "complianceSecretEnc" | "productionSecretEnc"> {
    const { privateKeyEnc, complianceSecretEnc, productionSecretEnc, ...safe } = device;
    void privateKeyEnc;
    void complianceSecretEnc;
    void productionSecretEnc;
    return safe;
  }
}

/** Hash helper re-export for the submission service. */
export { computeInvoiceHash };
