import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  InvoiceStatus,
  JournalSourceModule,
  PartnerType,
  Prisma,
  SalesDocumentKind,
  StockMovementType,
  VatCategory,
} from "@prisma/client";
import * as XLSX from "xlsx";
import { ZATCA_INVOICE_TYPE_CODES } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { ZatcaSubmissionService } from "../zatca/zatca-submission.service";
import { FbrSubmissionService } from "../fbr/fbr-submission.service";
import { InventoryService } from "../inventory/inventory.service";
import { AccountResolutionService } from "./account-resolution.service";
import { LineBuilderService } from "./line-builder.service";
import { CreateSalesInvoiceDto } from "./dto/create-sales-invoice.dto";

const OPEN_STATUSES: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID];

/** Column order of the sales-invoice import template (one row = one invoice line). */
const SALES_XLSX_COLUMNS = [
  "customerCode",
  "customerName",
  "customerTaxNumber",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "description",
  "amount",
  "amountType",
  "vatCategory",
  "revenueAccountCode",
  "costCenterCode",
] as const;

const SALES_XLSX_SAMPLE_ROW = [
  "C-001",
  "Al Falak Trading Est.",
  "300012345600003",
  "INV-2026-0456",
  "2026-10-15",
  "2026-11-15",
  "Scaffolding supply - October",
  "10000.00",
  "NET",
  "STANDARD_15",
  "4200",
  "",
];

/** Arabic-Indic / Persian digits to plain 0-9, and strip spaces, so a tax number matches however it was typed. */
function normalizeDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, "");
}

export interface SalesImportRowError {
  row: number;
  message: string;
}

@Injectable()
export class ArService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly glPostingService: GlPostingService,
    private readonly auditService: AuditService,
    private readonly zatcaSubmissionService: ZatcaSubmissionService,
    private readonly fbrSubmissionService: FbrSubmissionService,
    private readonly inventoryService: InventoryService,
    private readonly accountResolution: AccountResolutionService,
    private readonly lineBuilder: LineBuilderService,
  ) {}

  // ── Draft lifecycle ─────────────────────────────────────────────────

  async createDraft(companyId: string, userId: string, dto: CreateSalesInvoiceDto) {
    const documentKind = dto.documentKind ?? SalesDocumentKind.INVOICE;
    const partner = await this.getCustomer(companyId, dto.businessPartnerId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const currencyCode = (dto.currencyCode ?? company.baseCurrencyCode).toUpperCase();

    if (documentKind === SalesDocumentKind.CREDIT_NOTE) {
      if (!dto.originalInvoiceId) {
        throw new BadRequestException("A credit note must reference the original invoice (originalInvoiceId)");
      }
      const original = await this.getOwnedInvoice(companyId, dto.originalInvoiceId);
      if (original.documentKind !== SalesDocumentKind.INVOICE) {
        throw new BadRequestException("A credit note must reference an invoice, not another credit note");
      }
      if (original.businessPartnerId !== dto.businessPartnerId) {
        throw new BadRequestException("Credit note partner must match the original invoice's partner");
      }
      if (original.currencyCode !== currencyCode) {
        throw new BadRequestException("Credit note currency must match the original invoice's currency");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const built = await this.lineBuilder.buildLines(tx, companyId, "SALES", dto.lines, { partnerId: partner.id });

      return tx.salesInvoice.create({
        data: {
          companyId,
          documentKind,
          businessPartnerId: partner.id,
          originalInvoiceId: documentKind === SalesDocumentKind.CREDIT_NOTE ? dto.originalInvoiceId : null,
          sourceSalesOrderId: dto.salesOrderId,
          issueDateTime: new Date(dto.issueDateTime),
          postingDate: new Date(dto.postingDate),
          dueDate: new Date(dto.dueDate),
          currencyCode,
          netTotal: built.totals.netTotal,
          vatTotal: built.totals.vatTotal,
          furtherTaxTotal: built.totals.furtherTaxTotal,
          grossTotal: built.totals.grossTotal,
          memo: dto.memo,
          createdByUserId: userId,
          lines: {
            create: built.lines.map((line) => ({
              companyId,
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              uomId: line.uomId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              netAmount: line.netAmount,
              vatCategory: line.vatCategory,
              vatRate: line.vatRate,
              vatAmount: line.vatAmount,
              grossAmount: line.grossAmount,
              furtherTaxRate: line.furtherTaxRate,
              furtherTaxAmount: line.furtherTaxAmount,
              retailValue: line.retailValue,
              revenueAccountId: line.accountId,
              warehouseId: line.warehouseId,
              projectId: line.projectId,
              wbsTaskId: line.wbsTaskId,
              costCenterId: line.costCenterId,
            })),
          },
        },
        include: { lines: true, businessPartner: true },
      });
    });
  }

  async updateDraft(companyId: string, invoiceId: string, dto: CreateSalesInvoiceDto) {
    const existing = await this.getOwnedInvoice(companyId, invoiceId);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException("Only draft invoices can be edited");
    }
    // Replace-all semantics: delete the draft and recreate under the same id
    // is messier than delete-lines + update-header; do the latter.
    const partner = await this.getCustomer(companyId, dto.businessPartnerId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const currencyCode = (dto.currencyCode ?? company.baseCurrencyCode).toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const built = await this.lineBuilder.buildLines(tx, companyId, "SALES", dto.lines, { partnerId: partner.id });
      await tx.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: invoiceId } });
      return tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          businessPartnerId: partner.id,
          issueDateTime: new Date(dto.issueDateTime),
          postingDate: new Date(dto.postingDate),
          dueDate: new Date(dto.dueDate),
          currencyCode,
          netTotal: built.totals.netTotal,
          vatTotal: built.totals.vatTotal,
          furtherTaxTotal: built.totals.furtherTaxTotal,
          grossTotal: built.totals.grossTotal,
          memo: dto.memo,
          lines: {
            create: built.lines.map((line) => ({
              companyId,
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              uomId: line.uomId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              netAmount: line.netAmount,
              vatCategory: line.vatCategory,
              vatRate: line.vatRate,
              vatAmount: line.vatAmount,
              grossAmount: line.grossAmount,
              furtherTaxRate: line.furtherTaxRate,
              furtherTaxAmount: line.furtherTaxAmount,
              retailValue: line.retailValue,
              revenueAccountId: line.accountId,
              warehouseId: line.warehouseId,
              projectId: line.projectId,
              wbsTaskId: line.wbsTaskId,
              costCenterId: line.costCenterId,
            })),
          },
        },
        include: { lines: true, businessPartner: true },
      });
    });
  }

  async deleteDraft(companyId: string, invoiceId: string) {
    const existing = await this.getOwnedInvoice(companyId, invoiceId);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException("Only draft invoices can be deleted; cancel posted invoices instead");
    }
    await this.prisma.salesInvoice.delete({ where: { id: invoiceId } });
    return { deleted: true };
  }

  // ── Posting ─────────────────────────────────────────────────────────

  /**
   * @param opts.cashRefundAccountId  POS returns only: the credit note is a
   *   till refund — credit this cash/bank account instead of AR and leave the
   *   (already paid) original invoice untouched. The original must be a
   *   posted/paid invoice and the return may not exceed its gross total.
   */
  async postInvoice(
    companyId: string,
    invoiceId: string,
    userId: string,
    allowSoftClosedOverride: boolean,
    opts: { cashRefundAccountId?: string } = {},
  ) {
    const before = await this.getOwnedInvoice(companyId, invoiceId);
    if (before.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException("Only draft invoices can be posted");
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { lines: { include: { item: true, project: true } }, businessPartner: true },
      });

      // Post-time re-check: billing requires ACTIVE or COMPLETED projects.
      for (const line of invoice.lines) {
        if (line.project && line.project.status !== "ACTIVE" && line.project.status !== "COMPLETED") {
          throw new ConflictException(
            `Project ${line.project.code} is ${line.project.status} — billing requires ACTIVE or COMPLETED`,
          );
        }
      }

      const isCreditNote = invoice.documentKind === SalesDocumentKind.CREDIT_NOTE;
      let originalInvoice: { id: string; openAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; status: InvoiceStatus } | null = null;

      if (isCreditNote) {
        if (!invoice.originalInvoiceId) {
          throw new BadRequestException("Credit note has no original invoice reference");
        }
        const original = await tx.salesInvoice.findFirst({
          where: { id: invoice.originalInvoiceId, companyId },
        });
        if (opts.cashRefundAccountId) {
          if (!original || (!OPEN_STATUSES.includes(original.status) && original.status !== InvoiceStatus.PAID)) {
            throw new ConflictException("The original sale is not a posted invoice");
          }
          // Cap at the original sale less anything already returned.
          const priorReturns = await tx.salesInvoice.aggregate({
            where: {
              companyId,
              originalInvoiceId: original.id,
              documentKind: SalesDocumentKind.CREDIT_NOTE,
              status: { in: [InvoiceStatus.POSTED, InvoiceStatus.PAID] },
            },
            _sum: { grossTotal: true },
          });
          const returnable = original.grossTotal.sub(priorReturns._sum.grossTotal ?? 0);
          if (invoice.grossTotal.gt(returnable)) {
            throw new BadRequestException(`Return total (${invoice.grossTotal}) exceeds what is still returnable on the original sale (${returnable})`);
          }
        } else {
          if (!original || !OPEN_STATUSES.includes(original.status)) {
            throw new ConflictException("The original invoice is not open (posted/partially paid)");
          }
          if (invoice.grossTotal.gt(original.openAmount)) {
            throw new BadRequestException(
              `Credit note total (${invoice.grossTotal}) exceeds the original invoice's open amount (${original.openAmount})`,
            );
          }
          originalInvoice = original;
        }
      }

      const exchangeRate = await this.resolveExchangeRate(
        tx, companyId, invoice.currencyCode, invoice.postingDate,
      );

      const arAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.AR);
      const vatOutputAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.VAT_OUTPUT);

      const zero = new Prisma.Decimal(0);
      const glLines: PostedEntryLineInput[] = [];

      const grossFunctional = invoice.grossTotal.mul(exchangeRate).toDecimalPlaces(4);
      const vatFunctional = invoice.vatTotal.mul(exchangeRate).toDecimalPlaces(4);

      const refundAccount = opts.cashRefundAccountId
        ? await this.accountResolution.getBankOrCashAccount(tx, companyId, opts.cashRefundAccountId)
        : null;

      // AR control line (gross, partner-tagged) — or the till cash account
      // for a POS refund.
      glLines.push({
        accountId: refundAccount?.id ?? arAccount.id,
        debit: isCreditNote ? zero : grossFunctional,
        credit: isCreditNote ? grossFunctional : zero,
        amountInTransactionCurrency: invoice.grossTotal,
        businessPartnerId: refundAccount ? null : invoice.businessPartnerId,
        description: refundAccount ? "POS cash refund" : isCreditNote ? "Credit note" : "Sales invoice",
      });

      // Revenue per line (net) — job-costing dims on revenue legs only.
      for (const line of invoice.lines) {
        const netFunctional = line.netAmount.mul(exchangeRate).toDecimalPlaces(4);
        glLines.push({
          accountId: line.revenueAccountId,
          debit: isCreditNote ? netFunctional : zero,
          credit: isCreditNote ? zero : netFunctional,
          amountInTransactionCurrency: line.netAmount,
          description: line.description,
          // Explicit line dim (manpower billing) wins over the project's CC
          costCenterId: line.costCenterId ?? line.project?.costCenterId ?? null,
          wbsTaskId: line.wbsTaskId,
        });
      }

      // Output VAT (summed; omit when zero)
      if (invoice.vatTotal.gt(0)) {
        glLines.push({
          accountId: vatOutputAccount.id,
          debit: isCreditNote ? vatFunctional : zero,
          credit: isCreditNote ? zero : vatFunctional,
          amountInTransactionCurrency: invoice.vatTotal,
          description: "Output VAT",
        });
      }

      // Rounding guard: functional net+vat must equal functional gross. Any
      // residual from per-line rate multiplication lands on the AR line side
      // implicitly via balance check — instead of hiding it, rebalance the
      // gross line to the exact sum so the entry is provably balanced.
      const functionalRevenueTotal = invoice.lines.reduce(
        (sum, l) => sum.add(l.netAmount.mul(exchangeRate).toDecimalPlaces(4)),
        zero,
      );
      const balancedGross = functionalRevenueTotal.add(invoice.vatTotal.gt(0) ? vatFunctional : zero);
      if (isCreditNote) {
        glLines[0].credit = balancedGross;
      } else {
        glLines[0].debit = balancedGross;
      }

      // Inventory: issue stock (invoice) or return it (credit note) and add
      // the COGS legs to the SAME journal entry. Sorted for deterministic
      // lock order across concurrent posts.
      const inventoryLines = invoice.lines
        .filter((line) => line.item?.isInventoryItem && line.warehouseId)
        .sort((a, b) => (a.itemId! + a.warehouseId!).localeCompare(b.itemId! + b.warehouseId!));

      if (inventoryLines.length > 0) {
        const cogsAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.COGS);
        // COGS debit legs are grouped by job-costing dims (cost center +
        // task) — COGS is a job cost. Inventory credit legs stay grouped by
        // account only — they are balance-sheet control legs, undimensioned.
        const costByInventoryAccount = new Map<string, Prisma.Decimal>();
        const cogsByDims = new Map<string, { costCenterId: string | null; wbsTaskId: string | null; value: Prisma.Decimal }>();
        const addCogs = (line: (typeof inventoryLines)[number], value: Prisma.Decimal) => {
          const costCenterId = line.project?.costCenterId ?? null;
          const key = `${costCenterId ?? ""}|${line.wbsTaskId ?? ""}`;
          const existing = cogsByDims.get(key);
          if (existing) {
            existing.value = existing.value.add(value);
          } else {
            cogsByDims.set(key, { costCenterId, wbsTaskId: line.wbsTaskId, value });
          }
        };

        if (!isCreditNote) {
          for (const line of inventoryLines) {
            const issued = await this.inventoryService.issueStock(tx, {
              companyId,
              itemId: line.itemId!,
              warehouseId: line.warehouseId!,
              quantity: line.quantity,
              movementType: StockMovementType.ISSUE,
              sourceDocumentType: DocumentType.SALES_INVOICE,
              sourceDocumentId: invoice.id,
              postingDate: invoice.postingDate,
              userId,
            });
            const account = await this.inventoryService.resolveInventoryAccount(tx, companyId, line.item!);
            costByInventoryAccount.set(
              account.id,
              (costByInventoryAccount.get(account.id) ?? zero).add(issued.totalCost),
            );
            addCogs(line, issued.totalCost);
          }
        } else {
          // Credit note: stock returns at the ORIGINAL issue unit cost, read
          // from the original invoice's ISSUE movements (weighted average of
          // that invoice's issues per item; fallback current avg handled by
          // receiveStock cost input below).
          for (const line of inventoryLines) {
            const originalIssues = invoice.originalInvoiceId
              ? await tx.stockMovement.findMany({
                  where: {
                    companyId,
                    sourceDocumentId: invoice.originalInvoiceId,
                    sourceDocumentType: DocumentType.SALES_INVOICE,
                    movementType: StockMovementType.ISSUE,
                    itemId: line.itemId!,
                  },
                })
              : [];
            const issuedQty = originalIssues.reduce((s, m) => s.add(m.quantity), zero);
            const issuedCost = originalIssues.reduce((s, m) => s.add(m.totalCost), zero);
            const stockRow = await tx.itemWarehouseStock.findUnique({
              where: { itemId_warehouseId: { itemId: line.itemId!, warehouseId: line.warehouseId! } },
            });
            const unitCost = issuedQty.gt(0)
              ? issuedCost.div(issuedQty)
              : stockRow?.avgCost ?? zero;
            const totalCost = unitCost.mul(line.quantity).toDecimalPlaces(4);

            await this.inventoryService.receiveStock(tx, {
              companyId,
              itemId: line.itemId!,
              warehouseId: line.warehouseId!,
              quantity: line.quantity,
              totalCost,
              movementType: StockMovementType.RECEIPT,
              sourceDocumentType: DocumentType.CREDIT_NOTE,
              sourceDocumentId: invoice.id,
              postingDate: invoice.postingDate,
              userId,
              memo: `Credit note return`,
            });
            const account = await this.inventoryService.resolveInventoryAccount(tx, companyId, line.item!);
            costByInventoryAccount.set(
              account.id,
              (costByInventoryAccount.get(account.id) ?? zero).add(totalCost),
            );
            addCogs(line, totalCost);
          }
        }

        const totalCogs = [...costByInventoryAccount.values()].reduce((s, v) => s.add(v), zero);
        if (totalCogs.gt(0)) {
          // Invoice: Dr COGS (per dims) / Cr Inventory. Credit note: mirror.
          for (const group of cogsByDims.values()) {
            if (group.value.eq(0)) continue;
            glLines.push({
              accountId: cogsAccount.id,
              debit: isCreditNote ? zero : group.value,
              credit: isCreditNote ? group.value : zero,
              amountInTransactionCurrency: group.value,
              description: isCreditNote ? "COGS reversal (credit note)" : "Cost of goods sold",
              costCenterId: group.costCenterId,
              wbsTaskId: group.wbsTaskId,
            });
          }
          for (const [accountId, value] of costByInventoryAccount) {
            if (value.eq(0)) continue;
            glLines.push({
              accountId,
              debit: isCreditNote ? value : zero,
              credit: isCreditNote ? zero : value,
              amountInTransactionCurrency: value,
              description: isCreditNote ? "Stock return (credit note)" : "Inventory issue",
            });
          }
        }
      }

      const journalEntry = await this.glPostingService.createPostedEntry(tx, {
        companyId,
        userId,
        postingDate: invoice.postingDate,
        documentDate: invoice.issueDateTime,
        currencyCode: invoice.currencyCode,
        exchangeRateToFunctional: exchangeRate,
        sourceModule: JournalSourceModule.AR,
        sourceDocumentId: invoice.id,
        memo: invoice.memo ?? (isCreditNote ? "AR credit note" : "AR invoice"),
        allowSoftClosedOverride,
        lines: glLines,
      });

      const invoiceNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: isCreditNote ? DocumentType.CREDIT_NOTE : DocumentType.SALES_INVOICE,
        fiscalYearId: null,
      });

      // Credit notes settle immediately against the original invoice.
      if (isCreditNote && originalInvoice) {
        const newPaid = originalInvoice.paidAmount.add(invoice.grossTotal);
        const newOpen = originalInvoice.openAmount.sub(invoice.grossTotal);
        await tx.salesInvoice.update({
          where: { id: originalInvoice.id },
          data: {
            paidAmount: newPaid,
            openAmount: newOpen,
            status: newOpen.eq(0) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
          },
        });
      }

      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          status: isCreditNote ? InvoiceStatus.PAID : InvoiceStatus.POSTED,
          invoiceNumber,
          journalEntryId: journalEntry.id,
          exchangeRateToFunctional: exchangeRate,
          netTotalFunctional: invoice.netTotal.mul(exchangeRate).toDecimalPlaces(4),
          vatTotalFunctional: vatFunctional,
          grossTotalFunctional: grossFunctional,
          // A credit note has no receivable of its own — it settles the original.
          paidAmount: isCreditNote ? invoice.grossTotal : zero,
          openAmount: isCreditNote ? zero : invoice.grossTotal,
          buyerNameSnapshot: invoice.businessPartner.name,
          buyerTrnSnapshot: invoice.businessPartner.taxRegistrationNumber,
          buyerNtnCnicSnapshot: invoice.businessPartner.ntnCnic,
          buyerProvinceSnapshot: invoice.businessPartner.province,
          buyerRegTypeSnapshot: invoice.businessPartner.fbrRegistrationType,
          invoiceTypeCode: isCreditNote ? ZATCA_INVOICE_TYPE_CODES.CREDIT_NOTE : ZATCA_INVOICE_TYPE_CODES.INVOICE,
          deliveryDate: invoice.deliveryDate ?? invoice.postingDate,
          postedByUserId: userId,
          postedAt: new Date(),
        },
        include: { lines: true, businessPartner: true },
      });

      // ZATCA: reserve ICV/PIH + persist the signed XML atomically with the
      // posting. Returns null when the company has no ACTIVE device.
      const zatcaSubmissionId = await this.zatcaSubmissionService.prepareInTx(tx, invoiceId);
      // FBR (Pakistan): validates master data (throws → posting rolls back)
      // and records the DI/POS payload. Null unless PK + FBR enabled.
      const fbrSubmissionId = await this.fbrSubmissionService.prepareInTx(tx, invoiceId);

      return { updatedInvoice, zatcaSubmissionId, fbrSubmissionId };
      // Generous timeout: ZATCA signing is CPU-bound (~1s of EC key parsing)
      // and concurrent posts serialize on the device-row lock for the
      // ICV/PIH chain, so queue depth adds up under parallel posting.
    }, { timeout: 30000 });

    // HTTP submission happens strictly after commit — a ZATCA outage must
    // never roll back or block the accounting posting.
    if (posted.zatcaSubmissionId) {
      await this.zatcaSubmissionService.submitAfterPost(companyId, posted.zatcaSubmissionId, userId);
    }
    if (posted.fbrSubmissionId) {
      await this.fbrSubmissionService.submitAfterPost(companyId, posted.fbrSubmissionId, userId);
    }

    await this.auditService.log({
      companyId,
      entityName: "SalesInvoice",
      entityId: posted.updatedInvoice.id,
      action: "POST",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: posted.updatedInvoice,
    });

    return posted.updatedInvoice;
  }

  // ── Cancellation ─────────────────────────────────────────────────────

  // ── Excel import of invoices issued in another system ────────────────
  // One row = one invoice line. Rows sharing customerCode + invoiceNumber
  // become one multi-line invoice. The other system's invoice number is kept
  // in the memo as "[EXT:<number>]" (Universa still assigns its own gapless
  // number when an invoice is posted) and is what blocks importing the same
  // invoice twice. Lands as DRAFT unless postImmediately is set.

  salesXlsxTemplate(): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet([[...SALES_XLSX_COLUMNS], SALES_XLSX_SAMPLE_ROW]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sales invoices");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  async importInvoicesXlsx(companyId: string, userId: string, fileBuffer: Buffer, opts: { postImmediately: boolean }) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new BadRequestException("The uploaded file has no sheets");
    }
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    if (raw.length < 2) {
      throw new BadRequestException("Expected a header row and at least one data row");
    }
    const header = (raw[0] as unknown[]).map((h) => String(h).trim());
    if (header.join(",") !== SALES_XLSX_COLUMNS.join(",")) {
      throw new BadRequestException(`Column headers do not match the template. Expected: ${SALES_XLSX_COLUMNS.join(", ")}`);
    }

    if (opts.postImmediately) {
      // Posting an invoice submits it to ZATCA when e-invoicing is live for the
      // company. These invoices were already issued elsewhere, so never do that
      // silently.
      const activeDevice = await this.prisma.zatcaDevice.findFirst({ where: { companyId, status: "ACTIVE" } });
      if (activeDevice) {
        throw new ConflictException(
          "ZATCA e-invoicing is active for this company, so posting would submit these invoices to ZATCA again. Import them as drafts instead.",
        );
      }
    }

    const errors: SalesImportRowError[] = [];
    const vatCategories = Object.values(VatCategory) as string[];
    interface ParsedLine {
      row: number;
      description: string;
      amount: string;
      taxMode: "EXCLUSIVE" | "INCLUSIVE";
      vatCategory?: VatCategory;
      accountId: string;
      costCenterId?: string;
    }
    interface NewCustomer {
      code: string;
      name: string;
      taxRegistrationNumber?: string;
    }
    interface ParsedInvoice {
      customerKey: string;
      customerId?: string;
      newCustomer?: NewCustomer;
      invoiceNumber: string;
      issueDate: string;
      dueDate: string;
      lines: ParsedLine[];
    }
    const invoices = new Map<string, ParsedInvoice>();
    // Existing customer by code or tax number; or a customer to create when the
    // file gives a name but no match exists yet.
    const customerCache = new Map<string, { id?: string; create?: NewCustomer } | null>();
    const accountCache = new Map<string, string | null>();
    const costCenterCache = new Map<string, string | null>();

    for (let i = 1; i < raw.length; i++) {
      const rowNum = i + 1;
      const cells = raw[i] as unknown[];
      if (cells.length === 0 || cells.every((c) => String(c).trim() === "")) continue;
      const get = (idx: number) => String(cells[idx] ?? "").trim();
      const [
        customerCode,
        customerNameRaw,
        customerTaxRaw,
        invoiceNumber,
        issueDate,
        dueDateRaw,
        description,
        amount,
        amountTypeRaw,
        vatCategoryRaw,
        accountCode,
        costCenterCode,
      ] = SALES_XLSX_COLUMNS.map((_, idx) => get(idx));
      const customerName = customerNameRaw.normalize("NFKC");
      const customerTax = normalizeDigits(customerTaxRaw);
      const dueDate = dueDateRaw || issueDate;

      if (!customerCode && !customerTax) errors.push({ row: rowNum, message: "customerCode or customerTaxNumber is required" });
      if (!invoiceNumber) errors.push({ row: rowNum, message: "invoiceNumber is required" });
      if (!issueDate || isNaN(Date.parse(issueDate))) errors.push({ row: rowNum, message: "issueDate must be a valid date (YYYY-MM-DD)" });
      if (dueDate && isNaN(Date.parse(dueDate))) errors.push({ row: rowNum, message: "dueDate must be a valid date (YYYY-MM-DD)" });
      if (!description) errors.push({ row: rowNum, message: "description is required" });
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) errors.push({ row: rowNum, message: "amount must be a positive number" });
      const amountType = (amountTypeRaw || "NET").toUpperCase();
      if (amountType !== "NET" && amountType !== "GROSS") errors.push({ row: rowNum, message: "amountType must be NET or GROSS (blank = NET)" });
      if (vatCategoryRaw && !vatCategories.includes(vatCategoryRaw)) {
        errors.push({ row: rowNum, message: `vatCategory must be one of ${vatCategories.join(", ")}` });
      }
      if (!accountCode) errors.push({ row: rowNum, message: "revenueAccountCode is required" });

      const customerKey = customerCode || customerTax;
      let customer: { id?: string; create?: NewCustomer } | null = null;
      if (customerKey) {
        if (!customerCache.has(customerKey)) {
          const partners = await this.prisma.businessPartner.findMany({
            where: {
              companyId,
              isActive: true,
              OR: [...(customerCode ? [{ code: customerCode }] : []), ...(customerTax ? [{ taxRegistrationNumber: customerTax }] : [])],
            },
            select: { id: true, code: true, partnerType: true },
          });
          const found = partners.find((p) => p.code === customerCode) ?? partners[0];
          if (found) {
            customerCache.set(
              customerKey,
              found.partnerType === PartnerType.CUSTOMER || found.partnerType === PartnerType.BOTH ? { id: found.id } : null,
            );
            if (found.partnerType === PartnerType.VENDOR) {
              errors.push({ row: rowNum, message: `Partner "${found.code}" is a vendor, not a customer` });
            }
          } else if (customerName) {
            const code = customerCode || `C-${customerTax}`;
            const clash = await this.prisma.businessPartner.findUnique({ where: { companyId_code: { companyId, code } }, select: { id: true } });
            if (clash) {
              errors.push({ row: rowNum, message: `Partner code "${code}" already exists but is inactive or has a different tax number` });
              customerCache.set(customerKey, null);
            } else {
              customerCache.set(customerKey, { create: { code, name: customerName, taxRegistrationNumber: customerTax || undefined } });
            }
          } else {
            errors.push({ row: rowNum, message: `Customer "${customerKey}" not found — add a customerName to have it created, or add the partner first` });
            customerCache.set(customerKey, null);
          }
        }
        customer = customerCache.get(customerKey) ?? null;
      }

      let accountId: string | null = null;
      if (accountCode) {
        if (!accountCache.has(accountCode)) {
          const acc = await this.prisma.account.findFirst({ where: { companyId, code: accountCode, isPostable: true }, select: { id: true } });
          accountCache.set(accountCode, acc?.id ?? null);
        }
        accountId = accountCache.get(accountCode) ?? null;
        if (!accountId) errors.push({ row: rowNum, message: `Revenue account code "${accountCode}" not found or not postable` });
      }

      let costCenterId: string | undefined;
      if (costCenterCode) {
        if (!costCenterCache.has(costCenterCode)) {
          const cc = await this.prisma.costCenter.findFirst({ where: { companyId, code: costCenterCode, isActive: true }, select: { id: true } });
          costCenterCache.set(costCenterCode, cc?.id ?? null);
        }
        costCenterId = costCenterCache.get(costCenterCode) ?? undefined;
        if (!costCenterId) errors.push({ row: rowNum, message: `Cost center code "${costCenterCode}" not found or inactive` });
      }

      if (!customer || !accountId || !invoiceNumber) continue;
      const key = `${customerKey}|${invoiceNumber}`;
      let invoice = invoices.get(key);
      if (!invoice) {
        invoice = { customerKey, customerId: customer.id, newCustomer: customer.create, invoiceNumber, issueDate, dueDate, lines: [] };
        invoices.set(key, invoice);
      } else if (invoice.issueDate !== issueDate) {
        errors.push({ row: rowNum, message: `Invoice ${invoiceNumber} has different issue dates on different rows` });
      }
      invoice.lines.push({
        row: rowNum,
        description,
        amount,
        taxMode: amountType === "GROSS" ? "INCLUSIVE" : "EXCLUSIVE",
        vatCategory: vatCategoryRaw ? (vatCategoryRaw as VatCategory) : undefined,
        accountId,
        costCenterId,
      });
    }

    // Already imported earlier? (same customer + same external number, not cancelled)
    for (const inv of invoices.values()) {
      if (!inv.customerId) continue;
      const existing = await this.prisma.salesInvoice.findFirst({
        where: {
          companyId,
          businessPartnerId: inv.customerId,
          status: { not: InvoiceStatus.CANCELLED },
          memo: { startsWith: `[EXT:${inv.invoiceNumber}]` },
        },
        select: { id: true },
      });
      if (existing) {
        errors.push({ row: inv.lines[0].row, message: `Invoice "${inv.invoiceNumber}" for ${inv.customerKey} was already imported` });
      }
    }

    if (errors.length > 0) {
      return { imported: 0, posted: 0, customersCreated: 0, errors };
    }
    if (invoices.size === 0) {
      throw new BadRequestException("No data rows found in the file");
    }

    // Create the customers that didn't exist yet (once each), then the invoices.
    let customersCreated = 0;
    const createdCustomerIds = new Map<string, string>();
    for (const inv of invoices.values()) {
      if (inv.customerId || !inv.newCustomer) continue;
      let id = createdCustomerIds.get(inv.customerKey);
      if (!id) {
        const partner = await this.prisma.businessPartner.create({
          data: {
            companyId,
            code: inv.newCustomer.code,
            name: inv.newCustomer.name,
            partnerType: PartnerType.CUSTOMER,
            taxRegistrationNumber: inv.newCustomer.taxRegistrationNumber,
          },
        });
        id = partner.id;
        createdCustomerIds.set(inv.customerKey, id);
        customersCreated += 1;
      }
      inv.customerId = id;
    }

    const createdIds: string[] = [];
    let posted = 0;
    for (const inv of invoices.values()) {
      const draft = await this.createDraft(companyId, userId, {
        businessPartnerId: inv.customerId!,
        issueDateTime: inv.issueDate,
        postingDate: inv.issueDate,
        dueDate: inv.dueDate,
        memo: `[EXT:${inv.invoiceNumber}] Imported from another system`,
        lines: inv.lines.map((l) => ({
          description: l.description,
          quantity: "1",
          unitPrice: l.amount,
          vatCategory: l.vatCategory,
          taxMode: l.taxMode,
          accountId: l.accountId,
          costCenterId: l.costCenterId,
        })),
      });
      createdIds.push(draft.id);
      if (opts.postImmediately) {
        try {
          await this.postInvoice(companyId, draft.id, userId, false);
          posted += 1;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new ConflictException(
            `Invoice ${inv.invoiceNumber} was created but could not be posted (${reason}). ${createdIds.length - 1} earlier invoice(s) were imported, ${posted} of them posted; the rest of the file was not processed.`,
          );
        }
      }
    }

    await this.auditService.log({
      companyId,
      entityName: "SalesInvoice",
      entityId: "xlsx-import",
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { importedCount: createdIds.length, postedCount: posted, customersCreated, invoiceIds: createdIds },
    });

    return { imported: createdIds.length, posted, customersCreated, errors: [] as SalesImportRowError[] };
  }

  async cancelInvoice(companyId: string, invoiceId: string, userId: string) {
    const before = await this.getOwnedInvoice(companyId, invoiceId);
    if (before.status !== InvoiceStatus.POSTED) {
      throw new ConflictException("Only posted invoices can be cancelled");
    }
    if (!before.paidAmount.eq(0)) {
      throw new ConflictException(
        "This invoice has payments or credit notes applied — cancel those first",
      );
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Return issued stock at exactly the issued cost, so the mirror
      // reversal JE (which reverses the COGS/Inventory legs verbatim)
      // matches the subledger to the halalah.
      const issues = await tx.stockMovement.findMany({
        where: {
          companyId,
          sourceDocumentType: DocumentType.SALES_INVOICE,
          sourceDocumentId: invoiceId,
          movementType: StockMovementType.ISSUE,
        },
        orderBy: [{ itemId: "asc" }, { warehouseId: "asc" }],
      });

      let reversalEntryId: string | null = null;
      if (before.journalEntryId) {
        const reversal = await this.glPostingService.reverseEntryInTx(tx, companyId, before.journalEntryId, userId);
        reversalEntryId = reversal.id;
      }

      for (const issue of issues) {
        await this.inventoryService.receiveStock(tx, {
          companyId,
          itemId: issue.itemId,
          warehouseId: issue.warehouseId,
          quantity: issue.quantity,
          totalCost: issue.totalCost,
          movementType: StockMovementType.RECEIPT,
          sourceDocumentType: DocumentType.SALES_INVOICE,
          sourceDocumentId: invoiceId,
          postingDate: new Date(),
          userId,
          memo: `Cancellation of ${before.invoiceNumber}`,
        });
      }
      if (issues.length > 0 && reversalEntryId) {
        await this.inventoryService.linkMovementsToJournal(tx, DocumentType.SALES_INVOICE, invoiceId, reversalEntryId);
      }

      return tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.CANCELLED,
          openAmount: new Prisma.Decimal(0),
          cancelledByUserId: userId,
          cancelledAt: new Date(),
        },
        include: { lines: true },
      });
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "SalesInvoice",
      entityId: invoiceId,
      action: "REVERSE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });

    return cancelled;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  async list(
    companyId: string,
    filters: { status?: InvoiceStatus; businessPartnerId?: string; documentKind?: SalesDocumentKind },
  ) {
    return this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.businessPartnerId ? { businessPartnerId: filters.businessPartnerId } : {}),
        ...(filters.documentKind ? { documentKind: filters.documentKind } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        lines: true,
        businessPartner: { select: { code: true, name: true } },
        zatcaSubmission: { select: { id: true, status: true, invoiceKind: true, errors: true } },
        fbrSubmission: { select: { id: true, channel: true, environment: true, status: true, fbrInvoiceNumber: true, errors: true } },
      },
    });
  }

  async listOpen(companyId: string, businessPartnerId?: string) {
    return this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: OPEN_STATUSES },
        documentKind: SalesDocumentKind.INVOICE,
        ...(businessPartnerId ? { businessPartnerId } : {}),
      },
      orderBy: { dueDate: "asc" },
      include: { businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, invoiceId: string) {
    return this.getOwnedInvoice(companyId, invoiceId);
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async getOwnedInvoice(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        lines: { include: { item: true } },
        businessPartner: true,
        zatcaSubmission: {
          select: { id: true, status: true, icv: true, uuid: true, invoiceKind: true, qrCode: true, warnings: true, errors: true },
        },
        fbrSubmission: {
          select: { id: true, channel: true, environment: true, status: true, fbrInvoiceNumber: true, errors: true, acknowledgedAt: true },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException("Sales invoice not found");
    }
    return invoice;
  }

  private async getCustomer(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId, isActive: true } });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.CUSTOMER && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a customer`);
    }
    return partner;
  }

  private async resolveExchangeRate(
    tx: Prisma.TransactionClient,
    companyId: string,
    currencyCode: string,
    rateDate: Date,
  ): Promise<Prisma.Decimal> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (currencyCode === company.baseCurrencyCode) {
      return new Prisma.Decimal(1);
    }
    const rate = await tx.exchangeRate.findFirst({
      where: { companyId, fromCurrencyCode: currencyCode, toCurrencyCode: company.baseCurrencyCode, rateDate: { lte: rateDate } },
      orderBy: { rateDate: "desc" },
    });
    if (!rate) {
      throw new BadRequestException(
        `No exchange rate found from ${currencyCode} to ${company.baseCurrencyCode} on or before ${rateDate.toISOString()}`,
      );
    }
    return rate.rate;
  }
}
