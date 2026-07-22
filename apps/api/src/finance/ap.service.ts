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
  StockMovementType,
  VatCategory,
} from "@prisma/client";
import * as XLSX from "xlsx";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { AccountResolutionService } from "./account-resolution.service";
import { LineBuilderService } from "./line-builder.service";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto";

const OPEN_STATUSES: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID];

/** Column order of the Excel expense-import template. */
const EXPENSE_XLSX_COLUMNS = [
  "vendorCode",
  "vendorInvoiceNumber",
  "postingDate",
  "dueDate",
  "description",
  "amount",
  "expenseAccountCode",
  "costCenterCode",
  "vatCategory",
] as const;

const EXPENSE_XLSX_SAMPLE_ROW = [
  "V-001",
  "UTIL-2026-07",
  "2026-07-01",
  "2026-07-31",
  "July electricity bill",
  "850.00",
  "5240",
  "",
  "STANDARD_15",
];

export interface ImportRowError {
  row: number;
  message: string;
}

@Injectable()
export class ApService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly glPostingService: GlPostingService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly accountResolution: AccountResolutionService,
    private readonly lineBuilder: LineBuilderService,
  ) {}

  async createDraft(companyId: string, userId: string, dto: CreatePurchaseInvoiceDto) {
    const partner = await this.getVendor(companyId, dto.businessPartnerId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const currencyCode = (dto.currencyCode ?? company.baseCurrencyCode).toUpperCase();

    const duplicate = await this.prisma.purchaseInvoice.findFirst({
      where: {
        companyId,
        businessPartnerId: partner.id,
        vendorInvoiceNumber: dto.vendorInvoiceNumber,
        status: { not: InvoiceStatus.CANCELLED },
      },
    });
    if (duplicate) {
      throw new ConflictException(
        `Vendor invoice "${dto.vendorInvoiceNumber}" is already booked for this supplier (${duplicate.status})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const built = await this.lineBuilder.buildLines(tx, companyId, "PURCHASE", dto.lines);

      return tx.purchaseInvoice.create({
        data: {
          companyId,
          vendorInvoiceNumber: dto.vendorInvoiceNumber,
          businessPartnerId: partner.id,
          sourcePurchaseOrderId: dto.purchaseOrderId,
          postingDate: new Date(dto.postingDate),
          dueDate: new Date(dto.dueDate),
          currencyCode,
          netTotal: built.totals.netTotal,
          vatTotal: built.totals.vatTotal,
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
              expenseAccountId: line.accountId,
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

  // ── Excel expense import ─────────────────────────────────────────────
  // Separate, simpler path from the Quotation→Order→Invoice cycle above —
  // for non-PO expenses (utility bills, one-off vendor charges) where a
  // full procurement flow is overkill. One spreadsheet row = one
  // single-line DRAFT PurchaseInvoice (never auto-posted — lands as DRAFT
  // for the finance team to review, same as every other draft-first
  // document in this system).

  expensesXlsxTemplate(): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet([[...EXPENSE_XLSX_COLUMNS], EXPENSE_XLSX_SAMPLE_ROW]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Expenses");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /**
   * Validates every row up front (vendor/account/cost-center codes exist,
   * numeric/date fields parse, no in-file duplicate vendor+invoice number)
   * and only then creates invoices — one createDraft() call per row, each
   * its own transaction (createDraft already is one). This is "validated
   * up front, not a single all-spanning DB transaction": if a genuine race
   * causes one row's createDraft to fail after earlier rows already
   * committed, those earlier rows stay created — the error message says
   * exactly which row failed and how many already succeeded, since a true
   * multi-row atomic rollback would mean duplicating createDraft's GL/
   * numbering logic instead of reusing the already-proven method.
   */
  async importExpensesXlsx(companyId: string, userId: string, fileBuffer: Buffer) {
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
    if (header.join(",") !== EXPENSE_XLSX_COLUMNS.join(",")) {
      throw new BadRequestException(
        `Column headers do not match the template. Expected: ${EXPENSE_XLSX_COLUMNS.join(", ")}`,
      );
    }

    const errors: ImportRowError[] = [];
    interface ParsedRow {
      row: number;
      vendorId: string;
      vendorInvoiceNumber: string;
      postingDate: string;
      dueDate: string;
      description: string;
      amount: string;
      expenseAccountId: string;
      costCenterId?: string;
      vatCategory?: VatCategory;
    }
    const rows: ParsedRow[] = [];
    const seenWithinFile = new Set<string>();
    const vatCategories = Object.values(VatCategory) as string[];

    for (let i = 1; i < raw.length; i++) {
      const rowNum = i + 1;
      const cells = raw[i] as unknown[];
      if (cells.length === 0 || cells.every((c) => String(c).trim() === "")) continue; // skip blank rows
      const get = (idx: number) => String(cells[idx] ?? "").trim();
      const [vendorCode, vendorInvoiceNumber, postingDate, dueDate, description, amount, expenseAccountCode, costCenterCode, vatCategoryRaw] =
        EXPENSE_XLSX_COLUMNS.map((_, idx) => get(idx));

      if (!vendorCode) errors.push({ row: rowNum, message: "vendorCode is required" });
      if (!vendorInvoiceNumber) errors.push({ row: rowNum, message: "vendorInvoiceNumber is required" });
      if (!postingDate || isNaN(Date.parse(postingDate))) errors.push({ row: rowNum, message: "postingDate must be a valid date (YYYY-MM-DD)" });
      if (!dueDate || isNaN(Date.parse(dueDate))) errors.push({ row: rowNum, message: "dueDate must be a valid date (YYYY-MM-DD)" });
      if (!description) errors.push({ row: rowNum, message: "description is required" });
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) errors.push({ row: rowNum, message: "amount must be a positive number" });
      if (!expenseAccountCode) errors.push({ row: rowNum, message: "expenseAccountCode is required" });
      if (vatCategoryRaw && !vatCategories.includes(vatCategoryRaw)) {
        errors.push({ row: rowNum, message: `vatCategory must be one of ${vatCategories.join(", ")}` });
      }

      const dedupeKey = `${vendorCode}|${vendorInvoiceNumber}`;
      if (vendorCode && vendorInvoiceNumber) {
        if (seenWithinFile.has(dedupeKey)) {
          errors.push({ row: rowNum, message: `Duplicate vendor invoice ${vendorInvoiceNumber} for ${vendorCode} within the file` });
        }
        seenWithinFile.add(dedupeKey);
      }

      const vendor = vendorCode
        ? await this.prisma.businessPartner.findFirst({ where: { companyId, code: vendorCode, isActive: true } })
        : null;
      if (vendorCode && !vendor) {
        errors.push({ row: rowNum, message: `Vendor code "${vendorCode}" not found or inactive` });
      } else if (vendor && vendor.partnerType !== PartnerType.VENDOR && vendor.partnerType !== PartnerType.BOTH) {
        errors.push({ row: rowNum, message: `Partner "${vendorCode}" is not a vendor` });
      }

      const expenseAccount = expenseAccountCode
        ? await this.prisma.account.findFirst({ where: { companyId, code: expenseAccountCode, isPostable: true } })
        : null;
      if (expenseAccountCode && !expenseAccount) {
        errors.push({ row: rowNum, message: `Expense account code "${expenseAccountCode}" not found or not postable` });
      }

      const costCenter = costCenterCode
        ? await this.prisma.costCenter.findFirst({ where: { companyId, code: costCenterCode, isActive: true } })
        : null;
      if (costCenterCode && !costCenter) {
        errors.push({ row: rowNum, message: `Cost center code "${costCenterCode}" not found or inactive` });
      }

      if (vendor && expenseAccount) {
        // Duplicate-against-existing-DB check mirrors createDraft()'s own
        // guard, surfaced here up front instead of failing mid-import.
        const existing = await this.prisma.purchaseInvoice.findFirst({
          where: {
            companyId,
            businessPartnerId: vendor.id,
            vendorInvoiceNumber,
            status: { not: InvoiceStatus.CANCELLED },
          },
        });
        if (existing) {
          errors.push({ row: rowNum, message: `Vendor invoice "${vendorInvoiceNumber}" is already booked for ${vendorCode}` });
        }
      }

      if (vendor && expenseAccount) {
        rows.push({
          row: rowNum,
          vendorId: vendor.id,
          vendorInvoiceNumber,
          postingDate,
          dueDate,
          description,
          amount,
          expenseAccountId: expenseAccount.id,
          costCenterId: costCenter?.id,
          vatCategory: vatCategoryRaw ? (vatCategoryRaw as VatCategory) : undefined,
        });
      }
    }

    if (errors.length > 0) {
      return { imported: 0, errors };
    }
    if (rows.length === 0) {
      throw new BadRequestException("No data rows found in the file");
    }

    const created: string[] = [];
    for (const row of rows) {
      const invoice = await this.createDraft(companyId, userId, {
        businessPartnerId: row.vendorId,
        vendorInvoiceNumber: row.vendorInvoiceNumber,
        postingDate: row.postingDate,
        dueDate: row.dueDate,
        memo: row.description,
        lines: [
          {
            description: row.description,
            quantity: "1",
            unitPrice: row.amount,
            vatCategory: row.vatCategory,
            accountId: row.expenseAccountId,
            costCenterId: row.costCenterId,
          },
        ],
      });
      created.push(invoice.id);
    }

    await this.auditService.log({
      companyId,
      entityName: "PurchaseInvoice",
      entityId: "xlsx-import",
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: { importedCount: created.length, invoiceIds: created },
    });

    return { imported: created.length, errors: [] as ImportRowError[] };
  }

  async deleteDraft(companyId: string, invoiceId: string) {
    const existing = await this.getOwnedInvoice(companyId, invoiceId);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException("Only draft invoices can be deleted; cancel posted invoices instead");
    }
    await this.prisma.purchaseInvoice.delete({ where: { id: invoiceId } });
    return { deleted: true };
  }

  async postInvoice(companyId: string, invoiceId: string, userId: string, allowSoftClosedOverride: boolean) {
    const before = await this.getOwnedInvoice(companyId, invoiceId);
    if (before.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException("Only draft invoices can be posted");
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { lines: { include: { item: true, project: true } }, businessPartner: true },
      });

      // Post-time re-check: costs require an ACTIVE project (draft-time
      // validation can go stale if the project's status changed since).
      for (const line of invoice.lines) {
        if (line.project && line.project.status !== "ACTIVE") {
          throw new ConflictException(
            `Project ${line.project.code} is ${line.project.status} — costs require an ACTIVE project`,
          );
        }
      }

      const exchangeRate = await this.resolveExchangeRate(tx, companyId, invoice.currencyCode, invoice.postingDate);

      const apAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.AP);
      const vatInputAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.VAT_INPUT);

      const zero = new Prisma.Decimal(0);
      const vatFunctional = invoice.vatTotal.mul(exchangeRate).toDecimalPlaces(4);

      const glLines: PostedEntryLineInput[] = [];

      // Expense per line (net, debit) — job-costing dims on expense legs
      // only, never on control legs (AP/VAT).
      let functionalExpenseTotal = zero;
      for (const line of invoice.lines) {
        const netFunctional = line.netAmount.mul(exchangeRate).toDecimalPlaces(4);
        functionalExpenseTotal = functionalExpenseTotal.add(netFunctional);
        glLines.push({
          accountId: line.expenseAccountId,
          debit: netFunctional,
          credit: zero,
          amountInTransactionCurrency: line.netAmount,
          description: line.description,
          // Explicit line dim (equipment maintenance) wins over the project's CC
          costCenterId: line.costCenterId ?? line.project?.costCenterId ?? null,
          wbsTaskId: line.wbsTaskId,
        });
      }

      // Input VAT (debit; omit when zero)
      if (invoice.vatTotal.gt(0)) {
        glLines.push({
          accountId: vatInputAccount.id,
          debit: vatFunctional,
          credit: zero,
          amountInTransactionCurrency: invoice.vatTotal,
          description: "Input VAT",
        });
      }

      // AP control (gross, credit, partner-tagged) — balanced to the exact
      // functional sum of the debit lines to absorb per-line rounding.
      const balancedGross = functionalExpenseTotal.add(invoice.vatTotal.gt(0) ? vatFunctional : zero);
      glLines.push({
        accountId: apAccount.id,
        debit: zero,
        credit: balancedGross,
        amountInTransactionCurrency: invoice.grossTotal,
        businessPartnerId: invoice.businessPartnerId,
        description: "Purchase invoice",
      });

      // Inventory receipts: capitalize stock at the same functional net the
      // JE debits, so subledger and GL agree by construction. Sorted order
      // keeps row-lock acquisition deterministic across concurrent posts.
      const inventoryLines = invoice.lines
        .filter((line) => line.item?.isInventoryItem && line.warehouseId)
        .sort((a, b) => (a.itemId! + a.warehouseId!).localeCompare(b.itemId! + b.warehouseId!));
      for (const line of inventoryLines) {
        const netFunctional = line.netAmount.mul(exchangeRate).toDecimalPlaces(4);
        await this.inventoryService.receiveStock(tx, {
          companyId,
          itemId: line.itemId!,
          warehouseId: line.warehouseId!,
          quantity: line.quantity,
          totalCost: netFunctional,
          movementType: StockMovementType.RECEIPT,
          sourceDocumentType: DocumentType.PURCHASE_INVOICE,
          sourceDocumentId: invoice.id,
          postingDate: invoice.postingDate,
          userId,
          memo: `AP invoice ${invoice.vendorInvoiceNumber}`,
        });
      }

      const journalEntry = await this.glPostingService.createPostedEntry(tx, {
        companyId,
        userId,
        postingDate: invoice.postingDate,
        documentDate: invoice.postingDate,
        currencyCode: invoice.currencyCode,
        exchangeRateToFunctional: exchangeRate,
        sourceModule: JournalSourceModule.AP,
        sourceDocumentId: invoice.id,
        memo: invoice.memo ?? `AP invoice ${invoice.vendorInvoiceNumber}`,
        allowSoftClosedOverride,
        lines: glLines,
      });

      if (inventoryLines.length > 0) {
        await this.inventoryService.linkMovementsToJournal(tx, DocumentType.PURCHASE_INVOICE, invoice.id, journalEntry.id);
      }

      const invoiceNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.PURCHASE_INVOICE,
        fiscalYearId: null,
      });

      return tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.POSTED,
          invoiceNumber,
          journalEntryId: journalEntry.id,
          exchangeRateToFunctional: exchangeRate,
          netTotalFunctional: invoice.netTotal.mul(exchangeRate).toDecimalPlaces(4),
          vatTotalFunctional: vatFunctional,
          grossTotalFunctional: invoice.grossTotal.mul(exchangeRate).toDecimalPlaces(4),
          paidAmount: zero,
          openAmount: invoice.grossTotal,
          postedByUserId: userId,
          postedAt: new Date(),
        },
        include: { lines: true, businessPartner: true },
      });
      // Row locks on stock rows serialize concurrent inventory posts.
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "PurchaseInvoice",
      entityId: posted.id,
      action: "POST",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: posted,
    });

    return posted;
  }

  async cancelInvoice(companyId: string, invoiceId: string, userId: string) {
    const before = await this.getOwnedInvoice(companyId, invoiceId);
    if (before.status !== InvoiceStatus.POSTED) {
      throw new ConflictException("Only posted invoices can be cancelled");
    }
    if (!before.paidAmount.eq(0)) {
      throw new ConflictException("This invoice has payments applied — cancel those first");
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Un-do the stock receipts at their exact original value contribution.
      // issueStock's guards turn "goods already sold/transferred" into a
      // clear 409 instead of silently driving stock negative.
      const receipts = await tx.stockMovement.findMany({
        where: {
          companyId,
          sourceDocumentType: DocumentType.PURCHASE_INVOICE,
          sourceDocumentId: invoiceId,
          movementType: StockMovementType.RECEIPT,
        },
        orderBy: [{ itemId: "asc" }, { warehouseId: "asc" }],
      });
      for (const receipt of receipts) {
        await this.inventoryService.issueStock(tx, {
          companyId,
          itemId: receipt.itemId,
          warehouseId: receipt.warehouseId,
          quantity: receipt.quantity,
          forcedTotalCost: receipt.totalCost,
          movementType: StockMovementType.ISSUE,
          sourceDocumentType: DocumentType.PURCHASE_INVOICE,
          sourceDocumentId: invoiceId,
          postingDate: new Date(),
          userId,
          memo: `Cancellation of ${before.invoiceNumber}`,
        });
      }

      let reversalEntryId: string | null = null;
      if (before.journalEntryId) {
        const reversal = await this.glPostingService.reverseEntryInTx(tx, companyId, before.journalEntryId, userId);
        reversalEntryId = reversal.id;
      }
      if (receipts.length > 0 && reversalEntryId) {
        await this.inventoryService.linkMovementsToJournal(tx, DocumentType.PURCHASE_INVOICE, invoiceId, reversalEntryId);
      }

      return tx.purchaseInvoice.update({
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
      entityName: "PurchaseInvoice",
      entityId: invoiceId,
      action: "REVERSE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });

    return cancelled;
  }

  async list(companyId: string, filters: { status?: InvoiceStatus; businessPartnerId?: string }) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.businessPartnerId ? { businessPartnerId: filters.businessPartnerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { lines: true, businessPartner: { select: { code: true, name: true } } },
    });
  }

  async listOpen(companyId: string, businessPartnerId?: string) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        status: { in: OPEN_STATUSES },
        ...(businessPartnerId ? { businessPartnerId } : {}),
      },
      orderBy: { dueDate: "asc" },
      include: { businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, invoiceId: string) {
    return this.getOwnedInvoice(companyId, invoiceId);
  }

  private async getOwnedInvoice(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { lines: true, businessPartner: true },
    });
    if (!invoice) {
      throw new NotFoundException("Purchase invoice not found");
    }
    return invoice;
  }

  private async getVendor(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId, isActive: true } });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.VENDOR && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a vendor`);
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
