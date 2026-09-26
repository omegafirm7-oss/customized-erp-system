import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  FbrChannel,
  FbrEnvironment,
  FbrSubmissionStatus,
  Prisma,
  SalesDocumentKind,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AppConfig } from "../core/config/configuration";
import { decryptSecret } from "../zatca/crypto/key-encryption";
import { FbrApiClient } from "./fbr-api.client";
import { buildDiPayload, buildPosPayload, FbrSource, findFbrDataProblems } from "./fbr-payload.builder";
import { DiInvoicePayload, FbrCallResult, PosInvoicePayload } from "./fbr.types";


const sourceInclude = {
  company: { include: { fbrSettings: true } },
  businessPartner: { include: { addresses: true } },
  lines: { include: { item: true }, orderBy: { lineNumber: "asc" as const } },
  posSale: { include: { terminal: true } },
  originalInvoice: { include: { fbrSubmission: true } },
} satisfies Prisma.SalesInvoiceInclude;

type SourceInvoice = Prisma.SalesInvoiceGetPayload<{ include: typeof sourceInclude }>;

/**
 * Reports posted sales documents to FBR. Same lifecycle as ZATCA:
 *   prepareInTx (inside the posting transaction) validates master data —
 *   throwing rolls the posting back, so nothing unreportable is ever
 *   posted — and records a PENDING submission with the exact JSON;
 *   submit (after commit) does the HTTP call; an FBR outage never blocks
 *   or undoes accounting.
 * Channel: invoices created by a POS terminal go to IMS (POS), everything
 * else to Digital Invoicing (DI).
 */
@Injectable()
export class FbrSubmissionService {
  private readonly logger = new Logger(FbrSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly apiClient: FbrApiClient,
    private readonly auditService: AuditService,
  ) {}

  /** Returns the submission id, or null when FBR reporting is off for the company. */
  async prepareInTx(tx: Prisma.TransactionClient, invoiceId: string): Promise<string | null> {
    const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: sourceInclude });
    const settings = invoice.company.fbrSettings;
    if (invoice.company.countryCode !== "PK" || !settings?.enabled) {
      return null;
    }
    const channel = invoice.posSale ? FbrChannel.POS : FbrChannel.DI;
    const source = this.toSource(invoice);
    const problems = findFbrDataProblems(source, channel);
    if (problems.length > 0) {
      throw new BadRequestException(`Cannot post — FBR would reject this invoice:\n• ${problems.join("\n• ")}`);
    }
    const requestJson = this.buildPayload(invoice, source, channel, settings.environment);
    const submission = await tx.fbrSubmission.create({
      data: {
        companyId: invoice.companyId,
        channel,
        environment: settings.environment,
        salesInvoiceId: invoice.id,
        status: FbrSubmissionStatus.PENDING,
        requestJson: requestJson as unknown as Prisma.InputJsonValue,
      },
    });
    return submission.id;
  }

  /** HTTP call for a PENDING/FAILED/INVALID submission; runs outside any transaction. */
  async submit(companyId: string, submissionId: string, opts: { userId?: string; rebuild?: boolean } = {}) {
    let submission = await this.prisma.fbrSubmission.findFirst({ where: { id: submissionId, companyId } });
    if (!submission) {
      throw new NotFoundException("FBR submission not found");
    }
    if (submission.status === FbrSubmissionStatus.VALID) {
      throw new ConflictException("Already accepted by FBR");
    }

    const settings = await this.prisma.fbrSettings.findUnique({ where: { companyId } });
    if (!settings?.enabled) {
      throw new ConflictException("FBR reporting is disabled for this company");
    }

    // A rejected invoice is usually fixed by correcting master data (HS
    // code, NTN, province); rebuild the payload from current data so the
    // retry actually carries the fix. Amounts come from the immutable
    // posted lines, so only descriptive fields can change.
    if (opts.rebuild || submission.status === FbrSubmissionStatus.INVALID) {
      // Until FBR accepts it the invoice is not yet a fiscal document, so a
      // corrected buyer NTN/province may replace the posting-time snapshot.
      // Registration type stays frozen — it drove further tax, i.e. amounts.
      const current = await this.prisma.salesInvoice.findUniqueOrThrow({
        where: { id: submission.salesInvoiceId },
        select: { businessPartner: { select: { ntnCnic: true, province: true } } },
      });
      await this.prisma.salesInvoice.update({
        where: { id: submission.salesInvoiceId },
        data: {
          buyerNtnCnicSnapshot: current.businessPartner.ntnCnic,
          buyerProvinceSnapshot: current.businessPartner.province,
        },
      });
      const invoice = await this.prisma.salesInvoice.findUniqueOrThrow({
        where: { id: submission.salesInvoiceId },
        include: sourceInclude,
      });
      const source = this.toSource(invoice);
      const problems = findFbrDataProblems(source, submission.channel);
      if (problems.length > 0) {
        throw new BadRequestException(`Fix before resubmitting:\n• ${problems.join("\n• ")}`);
      }
      submission = await this.prisma.fbrSubmission.update({
        where: { id: submission.id },
        data: {
          environment: settings.environment,
          requestJson: this.buildPayload(invoice, source, submission.channel, settings.environment) as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const token = this.tokenFor(settings, submission.channel);
    const result: FbrCallResult<unknown> =
      submission.channel === FbrChannel.DI
        ? await this.apiClient.postDiInvoice(submission.environment, token, submission.requestJson as unknown as DiInvoicePayload)
        : await this.apiClient.postPosInvoice(submission.environment, token, submission.requestJson as unknown as PosInvoicePayload);

    const status: FbrSubmissionStatus =
      result.outcome === "ACCEPTED"
        ? FbrSubmissionStatus.VALID
        : result.outcome === "REJECTED"
          ? FbrSubmissionStatus.INVALID
          : result.outcome === "AUTH_FAILED"
            ? FbrSubmissionStatus.FAILED
            : FbrSubmissionStatus.PENDING;

    const updated = await this.prisma.fbrSubmission.update({
      where: { id: submission.id },
      data: {
        status,
        fbrInvoiceNumber: result.fbrInvoiceNumber,
        responseJson: (result.body ?? { httpStatus: result.httpStatus }) as Prisma.InputJsonValue,
        errors: result.errors.length ? (result.errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        retryCount: { increment: 1 },
        lastAttemptAt: new Date(),
        acknowledgedAt: status === FbrSubmissionStatus.VALID ? new Date() : null,
      },
    });

    await this.auditService.log({
      companyId,
      entityName: "FbrSubmission",
      entityId: submission.id,
      action: "UPDATE",
      changedByUserId: opts.userId ?? null,
      afterSnapshot: { status, outcome: result.outcome, httpStatus: result.httpStatus, fbrInvoiceNumber: result.fbrInvoiceNumber },
    });

    return updated;
  }

  /** Post-commit wrapper: a network failure must never bubble into the posting response. */
  async submitAfterPost(companyId: string, submissionId: string, userId?: string) {
    try {
      return await this.submit(companyId, submissionId, { userId });
    } catch (error) {
      this.logger.warn(`Post-commit FBR submission ${submissionId} failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Background retry of transient/auth failures with exponential backoff
   * (1, 2, 4 … capped at 60 minutes). INVALID ones need a human to fix data.
   */
  async retryDue(now = new Date()) {
    const { maxRetries } = this.configService.get("fbr", { infer: true });
    const candidates = await this.prisma.fbrSubmission.findMany({
      where: {
        status: { in: [FbrSubmissionStatus.PENDING, FbrSubmissionStatus.FAILED] },
        retryCount: { lt: maxRetries },
        company: { fbrSettings: { enabled: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let attempted = 0;
    for (const submission of candidates) {
      const backoffMinutes = Math.min(60, 2 ** Math.max(0, submission.retryCount - 1));
      const dueAt = (submission.lastAttemptAt?.getTime() ?? 0) + backoffMinutes * 60_000;
      if (submission.lastAttemptAt && dueAt > now.getTime()) continue;
      attempted++;
      await this.submitAfterPost(submission.companyId, submission.id);
    }
    return { candidates: candidates.length, attempted };
  }

  async list(companyId: string, filters: { status?: FbrSubmissionStatus; channel?: FbrChannel }) {
    return this.prisma.fbrSubmission.findMany({
      where: { companyId, ...(filters.status ? { status: filters.status } : {}), ...(filters.channel ? { channel: filters.channel } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true, channel: true, environment: true, status: true, fbrInvoiceNumber: true, errors: true,
        retryCount: true, lastAttemptAt: true, acknowledgedAt: true, createdAt: true,
        salesInvoice: { select: { id: true, invoiceNumber: true, grossTotal: true, documentKind: true, buyerNameSnapshot: true } },
      },
    });
  }

  async get(companyId: string, submissionId: string) {
    const submission = await this.prisma.fbrSubmission.findFirst({
      where: { id: submissionId, companyId },
      include: { salesInvoice: { select: { invoiceNumber: true, documentKind: true, status: true, grossTotal: true } } },
    });
    if (!submission) throw new NotFoundException("FBR submission not found");
    return submission;
  }

  async summary(companyId: string) {
    const grouped = await this.prisma.fbrSubmission.groupBy({
      by: ["channel", "status"],
      where: { companyId },
      _count: { _all: true },
    });
    // Posted sales documents with no submission at all — only possible if
    // they were posted before FBR was enabled.
    const unreported = await this.prisma.salesInvoice.count({
      where: { companyId, status: { not: "DRAFT" }, fbrSubmission: null, company: { countryCode: "PK" } },
    });
    return {
      byChannelAndStatus: grouped.map((g) => ({ channel: g.channel, status: g.status, count: g._count._all })),
      unreportedPostedInvoices: unreported,
    };
  }

  // ── internals ──────────────────────────────────────────────────────

  private tokenFor(settings: { diTokenEnc: string | null; posTokenEnc: string | null; environment: FbrEnvironment }, channel: FbrChannel) {
    if (settings.environment === FbrEnvironment.MOCK) return null;
    const enc = channel === FbrChannel.DI ? settings.diTokenEnc : settings.posTokenEnc;
    if (!enc) return null;
    return decryptSecret(enc, this.configService.get("zatca", { infer: true }).encryptionKey);
  }

  private buildPayload(invoice: SourceInvoice, source: FbrSource, channel: FbrChannel, environment: FbrEnvironment) {
    if (channel === FbrChannel.POS) {
      return buildPosPayload(source, { posId: invoice.posSale!.terminal.fbrPosId, paymentMode: invoice.posSale!.paymentMode });
    }
    return buildDiPayload(source, { sandbox: environment !== FbrEnvironment.PRODUCTION });
  }

  private toSource(invoice: SourceInvoice): FbrSource {
    const isReturn = invoice.documentKind === SalesDocumentKind.CREDIT_NOTE;
    // A POS sale is booked to the terminal's walk-in customer; the buyer the
    // cashier captured (name / NTN-CNIC / phone) is what FBR must see.
    const posBuyer = (invoice.posSale?.rawPayload as { buyer?: { name?: string; ntnCnic?: string; phone?: string } } | undefined)?.buyer;
    if (posBuyer) {
      return this.withPosBuyer(this.toSourceBase(invoice, isReturn), posBuyer);
    }
    return this.toSourceBase(invoice, isReturn);
  }

  private withPosBuyer(source: FbrSource, buyer: { name?: string; ntnCnic?: string; phone?: string }): FbrSource {
    return {
      ...source,
      buyer: { ...source.buyer, name: buyer.name || source.buyer.name, ntnCnic: buyer.ntnCnic ?? null, phone: buyer.phone ?? null },
    };
  }

  private toSourceBase(invoice: SourceInvoice, isReturn: boolean): FbrSource {
    const company = invoice.company;
    const partner = invoice.businessPartner;
    const address = partner.addresses[0];
    return {
      isReturn,
      invoiceNumber: invoice.invoiceNumber ?? "",
      postingDate: invoice.postingDate,
      issueDateTime: invoice.issueDateTime,
      exchangeRate: invoice.exchangeRateToFunctional,
      seller: {
        ntn: company.ntn,
        legalName: company.legalName,
        province: company.province,
        address: [company.addressLine1, company.city].filter(Boolean).join(", ") || null,
        businessActivity: company.fbrBusinessActivity,
      },
      buyer: {
        // Snapshots are set at posting; fall back to the live partner for
        // the in-transaction prepare (snapshot written just before).
        ntnCnic: invoice.buyerNtnCnicSnapshot ?? partner.ntnCnic,
        name: invoice.buyerNameSnapshot ?? partner.name,
        province: invoice.buyerProvinceSnapshot ?? partner.province,
        address: address ? [address.street, address.city].filter(Boolean).join(", ") || null : null,
        registrationType: invoice.buyerRegTypeSnapshot ?? partner.fbrRegistrationType,
      },
      originalFbrInvoiceNumber: isReturn ? invoice.originalInvoice?.fbrSubmission?.fbrInvoiceNumber ?? null : null,
      originalUsin: isReturn ? invoice.originalInvoice?.invoiceNumber ?? null : null,
      lines: invoice.lines.map((line) => ({
        itemCode: line.item?.code ?? null,
        description: line.description,
        hsCode: line.item?.hsCode ?? null,
        fbrUom: line.item?.fbrUom ?? null,
        fbrSaleType: line.item?.fbrSaleType ?? null,
        sroScheduleNo: line.item?.sroScheduleNo ?? null,
        sroItemSerialNo: line.item?.sroItemSerialNo ?? null,
        quantity: line.quantity,
        discountAmount: line.discountAmount,
        netAmount: line.netAmount,
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
        vatAmount: line.vatAmount,
        furtherTaxAmount: line.furtherTaxAmount,
        grossAmount: line.grossAmount,
        retailValue: line.retailValue,
      })),
    };
  }
}
