import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  SalesDocumentKind,
  ZatcaDeviceStatus,
  ZatcaInvoiceKind,
  ZatcaSubmissionStatus,
  ZatcaSubmissionType,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { DOMParser } from "@xmldom/xmldom";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ZatcaApiClient, CsidCredentials } from "./zatca-api.client";
import { ZatcaDeviceService } from "./zatca-device.service";
import { buildUblInvoiceXml } from "./ubl/ubl-builder";
import { UblInvoiceInput } from "./ubl/ubl-types";
import { signInvoice, embedQrInXml } from "./crypto/xades";
import { buildQrPayload } from "./crypto/tlv";
import { decryptSecret } from "./crypto/key-encryption";
import { AppConfig } from "../core/config/configuration";

type TxClient = Prisma.TransactionClient;

type PostedInvoice = Prisma.SalesInvoiceGetPayload<{
  include: { lines: true; businessPartner: { include: { addresses: true } }; originalInvoice: true };
}>;

@Injectable()
export class ZatcaSubmissionService {
  private readonly logger = new Logger(ZatcaSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly apiClient: ZatcaApiClient,
    private readonly deviceService: ZatcaDeviceService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Called INSIDE the invoice-post transaction, after the invoice number is
   * allocated and the invoice row updated to POSTED. Locks the device row
   * (SELECT ... FOR UPDATE — the ICV/PIH chain requires generation to be
   * serialized per device), reserves ICV, builds + signs the UBL XML,
   * generates the QR for simplified invoices, creates the PENDING submission
   * row, and advances the device chain state. Pure CPU + DB — no HTTP here.
   *
   * Returns the submission id, or null when the company has no ACTIVE device
   * (ZATCA is optional per company until onboarded).
   */
  async prepareInTx(tx: TxClient, invoiceId: string): Promise<string | null> {
    const invoice = await tx.salesInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true, businessPartner: { include: { addresses: true } }, originalInvoice: true },
    });

    // Row-lock the active device (if any) for this company.
    const devices = await tx.$queryRaw<Array<{ id: string; icvCounter: number; lastInvoiceHash: string; environment: string; complianceCsid: string | null; productionCsid: string | null; privateKeyEnc: string; status: string }>>`
      SELECT "id", "icvCounter", "lastInvoiceHash", "environment", "complianceCsid", "productionCsid", "privateKeyEnc", "status"
      FROM "zatca_devices"
      WHERE "companyId" = ${invoice.companyId} AND "status" = 'ACTIVE'
      ORDER BY "onboardedAt" DESC
      LIMIT 1
      FOR UPDATE
    `;
    const device = devices[0];
    if (!device) {
      return null;
    }

    const encryptionKey = this.configService.get("zatca", { infer: true }).encryptionKey;
    const privateKeyPem = decryptSecret(device.privateKeyEnc, encryptionKey);
    const certificate = device.productionCsid!;

    const icv = device.icvCounter + 1;
    const pih = device.lastInvoiceHash;

    // Kind: buyer TRN → STANDARD/clearance, else SIMPLIFIED/reporting.
    // Credit notes inherit the kind of the original invoice's submission.
    let kind: ZatcaInvoiceKind;
    if (invoice.documentKind === SalesDocumentKind.CREDIT_NOTE && invoice.originalInvoiceId) {
      const originalSubmission = await tx.zatcaSubmission.findUnique({
        where: { salesInvoiceId: invoice.originalInvoiceId },
      });
      kind = originalSubmission?.invoiceKind ?? (invoice.buyerTrnSnapshot ? ZatcaInvoiceKind.STANDARD : ZatcaInvoiceKind.SIMPLIFIED);
    } else {
      kind = invoice.buyerTrnSnapshot ? ZatcaInvoiceKind.STANDARD : ZatcaInvoiceKind.SIMPLIFIED;
    }

    const uuid = randomUUID();
    const ublInput = await this.buildUblInput(tx, invoice, kind, uuid, icv, pih);
    const unsignedXml = buildUblInvoiceXml(ublInput);
    const signed = signInvoice({ unsignedXml, certificateBase64: certificate, privateKeyPem });

    let signedXml = signed.signedXml;
    let qrCode: string | null = null;
    if (kind === ZatcaInvoiceKind.SIMPLIFIED) {
      qrCode = buildQrPayload({
        sellerName: ublInput.seller.legalName,
        sellerVatNumber: ublInput.seller.vatNumber,
        // Must equal IssueDate + "T" + IssueTime exactly (KSA-25).
        timestamp: `${ublInput.issueDate}T${ublInput.issueTime}`,
        invoiceTotal: ublInput.grossTotal,
        vatTotal: ublInput.vatTotal,
        invoiceHash: signed.invoiceHash,
        // Tag 7 is the base64 STRING of the signature (textual match with
        // ds:SignatureValue), not the decoded DER bytes.
        signature: Buffer.from(signed.signatureBase64, "utf8"),
        publicKey: signed.parsedCertificate.publicKeyDer,
        certificateSignature: signed.parsedCertificate.signatureBytes,
      });
      signedXml = embedQrInXml(signedXml, qrCode);
    }

    const submission = await tx.zatcaSubmission.create({
      data: {
        companyId: invoice.companyId,
        deviceId: device.id,
        salesInvoiceId: invoice.id,
        uuid,
        icv,
        invoiceHash: signed.invoiceHash,
        previousInvoiceHash: pih,
        invoiceKind: kind,
        submissionType: kind === ZatcaInvoiceKind.STANDARD ? ZatcaSubmissionType.CLEARANCE : ZatcaSubmissionType.REPORTING,
        signedXml,
        qrCode,
        status: ZatcaSubmissionStatus.PENDING,
      },
    });

    await tx.zatcaDevice.update({
      where: { id: device.id },
      data: { icvCounter: icv, lastInvoiceHash: signed.invoiceHash },
    });

    return submission.id;
  }

  /** Fires the HTTP submission for a PENDING/FAILED submission and updates
   * its status. Runs OUTSIDE any DB transaction. */
  async submit(companyId: string, submissionId: string, userId?: string) {
    const submission = await this.prisma.zatcaSubmission.findFirst({
      where: { id: submissionId, companyId },
      include: { device: true },
    });
    if (!submission) {
      throw new NotFoundException("ZATCA submission not found");
    }
    if (submission.status !== ZatcaSubmissionStatus.PENDING && submission.status !== ZatcaSubmissionStatus.FAILED) {
      throw new ConflictException(`Submission is ${submission.status} — only PENDING/FAILED can be submitted`);
    }
    if (submission.device.status !== ZatcaDeviceStatus.ACTIVE) {
      throw new ConflictException("The submitting device is no longer active");
    }

    const encryptionKey = this.configService.get("zatca", { infer: true }).encryptionKey;
    const credentials: CsidCredentials = {
      binarySecurityToken: submission.device.productionCsid!,
      secret: decryptSecret(submission.device.productionSecretEnc!, encryptionKey),
    };

    const payload = {
      invoiceHash: submission.invoiceHash,
      uuid: submission.uuid,
      invoice: Buffer.from(submission.signedXml, "utf8").toString("base64"),
    };

    const result =
      submission.submissionType === ZatcaSubmissionType.CLEARANCE
        ? await this.apiClient.clearInvoice(submission.device.environment, credentials, payload)
        : await this.apiClient.reportInvoice(submission.device.environment, credentials, payload);

    const validationResults = (result.body?.validationResults ?? null) as Record<string, unknown> | null;
    const warnings = (validationResults?.warningMessages as unknown[]) ?? null;
    const errors = (validationResults?.errorMessages as unknown[]) ?? null;

    let status: ZatcaSubmissionStatus;
    let clearedXml: string | null = null;
    let qrCode = submission.qrCode;

    if (result.outcome === "ACCEPTED" || result.outcome === "ACCEPTED_WITH_WARNINGS") {
      if (submission.submissionType === ZatcaSubmissionType.CLEARANCE) {
        status = ZatcaSubmissionStatus.CLEARED;
        const clearedB64 = result.body?.clearedInvoice as string | undefined;
        if (clearedB64) {
          clearedXml = Buffer.from(clearedB64, "base64").toString("utf8");
          qrCode = this.extractQrFromXml(clearedXml) ?? qrCode;
        }
      } else {
        status = ZatcaSubmissionStatus.REPORTED;
      }
    } else if (result.outcome === "REJECTED") {
      status = ZatcaSubmissionStatus.REJECTED;
    } else {
      status = ZatcaSubmissionStatus.FAILED;
    }

    const updated = await this.prisma.zatcaSubmission.update({
      where: { id: submission.id },
      data: {
        status,
        clearedXml,
        qrCode,
        zatcaResponse: (result.body ?? { error: result.errorMessage }) as never,
        warnings: warnings as never,
        errors: errors as never,
        retryCount: { increment: submission.status === ZatcaSubmissionStatus.FAILED ? 1 : 0 },
        lastAttemptAt: new Date(),
        submittedAt: status === ZatcaSubmissionStatus.CLEARED || status === ZatcaSubmissionStatus.REPORTED ? new Date() : null,
      },
    });

    await this.auditService.log({
      companyId,
      entityName: "ZatcaSubmission",
      entityId: submission.id,
      action: "UPDATE",
      changedByUserId: userId ?? null,
      afterSnapshot: { status: updated.status, outcome: result.outcome, httpStatus: result.httpStatus },
    });

    return updated;
  }

  /** Fire-and-log wrapper used right after the posting transaction commits:
   * a network failure here must never bubble into the posting response. */
  async submitAfterPost(companyId: string, submissionId: string, userId: string) {
    try {
      return await this.submit(companyId, submissionId, userId);
    } catch (error) {
      this.logger.warn(
        `Post-commit ZATCA submission ${submissionId} failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  async list(companyId: string, status?: ZatcaSubmissionStatus) {
    return this.prisma.zatcaSubmission.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, salesInvoiceId: true, uuid: true, icv: true, invoiceHash: true,
        invoiceKind: true, submissionType: true, status: true, warnings: true,
        errors: true, retryCount: true, lastAttemptAt: true, submittedAt: true, createdAt: true,
        salesInvoice: { select: { invoiceNumber: true, grossTotal: true } },
      },
    });
  }

  async get(companyId: string, submissionId: string) {
    const submission = await this.prisma.zatcaSubmission.findFirst({
      where: { id: submissionId, companyId },
      include: { salesInvoice: { select: { invoiceNumber: true, documentKind: true, status: true } } },
    });
    if (!submission) {
      throw new NotFoundException("ZATCA submission not found");
    }
    return submission;
  }

  /** For standard invoices only the ZATCA-cleared XML may be shared. */
  async getDistributableXml(companyId: string, submissionId: string): Promise<{ filename: string; xml: string }> {
    const submission = await this.get(companyId, submissionId);
    if (submission.invoiceKind === ZatcaInvoiceKind.STANDARD) {
      if (submission.status !== ZatcaSubmissionStatus.CLEARED || !submission.clearedXml) {
        throw new ConflictException("Standard invoices may only be shared after ZATCA clearance");
      }
      return { filename: `${submission.salesInvoice.invoiceNumber}-cleared.xml`, xml: submission.clearedXml };
    }
    return { filename: `${submission.salesInvoice.invoiceNumber}.xml`, xml: submission.signedXml };
  }

  private extractQrFromXml(xml: string): string | null {
    try {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const refs = doc.getElementsByTagName("cac:AdditionalDocumentReference");
      for (let i = 0; i < refs.length; i++) {
        const ref = refs.item(i);
        if (!ref) continue;
        const ids = ref.getElementsByTagName("cbc:ID");
        if (ids.item(0)?.textContent === "QR") {
          const embedded = ref.getElementsByTagName("cbc:EmbeddedDocumentBinaryObject").item(0);
          return embedded?.textContent?.trim() ?? null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async buildUblInput(
    tx: TxClient,
    invoice: PostedInvoice,
    kind: ZatcaInvoiceKind,
    uuid: string,
    icv: number,
    pih: string,
  ): Promise<UblInvoiceInput> {
    const seller = await this.deviceService.getSellerOrThrow(invoice.companyId, tx);

    const billingAddress = invoice.businessPartner.addresses.find((a) => a.addressType === "BILLING") ?? invoice.businessPartner.addresses[0];
    const isCreditNote = invoice.documentKind === SalesDocumentKind.CREDIT_NOTE;

    const issue = invoice.issueDateTime.toISOString();
    const totalDiscount = invoice.lines.reduce((sum, l) => sum.add(l.discountAmount), new Prisma.Decimal(0));

    return {
      kind,
      invoiceTypeCode: invoice.invoiceTypeCode ?? (isCreditNote ? "381" : "388"),
      invoiceNumber: invoice.invoiceNumber!,
      uuid,
      issueDate: issue.slice(0, 10),
      issueTime: issue.slice(11, 19),
      icv,
      previousInvoiceHash: pih,
      currencyCode: invoice.currencyCode,
      billingReferenceId: isCreditNote ? invoice.originalInvoice?.invoiceNumber ?? null : null,
      instructionNote: isCreditNote ? invoice.creditNoteReason ?? "Credit note" : null,
      paymentMeansCode: invoice.paymentMeansCode ?? (kind === ZatcaInvoiceKind.SIMPLIFIED ? "10" : "30"),
      deliveryDate: (invoice.deliveryDate ?? invoice.postingDate).toISOString().slice(0, 10),
      seller,
      buyer: {
        name: invoice.buyerNameSnapshot ?? invoice.businessPartner.name,
        vatNumber: invoice.buyerTrnSnapshot,
        additionalIdScheme: invoice.businessPartner.additionalIdScheme,
        additionalIdNumber: invoice.businessPartner.additionalIdNumber,
        streetName: billingAddress?.street ?? null,
        buildingNumber: billingAddress?.buildingNumber ?? null,
        district: billingAddress?.district ?? null,
        city: billingAddress?.city ?? null,
        postalCode: billingAddress?.postalCode ?? null,
        countryCode: billingAddress?.countryCode ?? "SA",
      },
      lines: invoice.lines.map((line) => ({
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity.toString(),
        unitCode: "PCE",
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        netAmount: line.netAmount.toString(),
        vatCategory: line.vatCategory,
        vatRate: line.vatRate.toString(),
        vatAmount: line.vatAmount.toString(),
        grossAmount: line.grossAmount.toString(),
        vatExemptionReasonCode: line.vatExemptionReasonCode,
        vatExemptionReasonText: line.vatExemptionReasonText,
      })),
      netTotal: invoice.netTotal.toString(),
      vatTotal: invoice.vatTotal.toString(),
      grossTotal: invoice.grossTotal.toString(),
      totalDiscount: totalDiscount.toString(),
      vatTotalSar: invoice.vatTotalFunctional.toString(),
    };
  }
}
