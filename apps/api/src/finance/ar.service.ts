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
} from "@prisma/client";
import { ZATCA_INVOICE_TYPE_CODES } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { ZatcaSubmissionService } from "../zatca/zatca-submission.service";
import { InventoryService } from "../inventory/inventory.service";
import { AccountResolutionService } from "./account-resolution.service";
import { LineBuilderService } from "./line-builder.service";
import { CreateSalesInvoiceDto } from "./dto/create-sales-invoice.dto";

const OPEN_STATUSES: InvoiceStatus[] = [InvoiceStatus.POSTED, InvoiceStatus.PARTIALLY_PAID];

@Injectable()
export class ArService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly glPostingService: GlPostingService,
    private readonly auditService: AuditService,
    private readonly zatcaSubmissionService: ZatcaSubmissionService,
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
      const built = await this.lineBuilder.buildLines(tx, companyId, "SALES", dto.lines);

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
      const built = await this.lineBuilder.buildLines(tx, companyId, "SALES", dto.lines);
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

  async postInvoice(companyId: string, invoiceId: string, userId: string, allowSoftClosedOverride: boolean) {
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

      const exchangeRate = await this.resolveExchangeRate(
        tx, companyId, invoice.currencyCode, invoice.postingDate,
      );

      const arAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.AR);
      const vatOutputAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.VAT_OUTPUT);

      const zero = new Prisma.Decimal(0);
      const glLines: PostedEntryLineInput[] = [];

      const grossFunctional = invoice.grossTotal.mul(exchangeRate).toDecimalPlaces(4);
      const vatFunctional = invoice.vatTotal.mul(exchangeRate).toDecimalPlaces(4);

      // AR control line (gross, partner-tagged)
      glLines.push({
        accountId: arAccount.id,
        debit: isCreditNote ? zero : grossFunctional,
        credit: isCreditNote ? grossFunctional : zero,
        amountInTransactionCurrency: invoice.grossTotal,
        businessPartnerId: invoice.businessPartnerId,
        description: isCreditNote ? "Credit note" : "Sales invoice",
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

      return { updatedInvoice, zatcaSubmissionId };
      // Generous timeout: ZATCA signing is CPU-bound (~1s of EC key parsing)
      // and concurrent posts serialize on the device-row lock for the
      // ICV/PIH chain, so queue depth adds up under parallel posting.
    }, { timeout: 30000 });

    // HTTP submission happens strictly after commit — a ZATCA outage must
    // never roll back or block the accounting posting.
    if (posted.zatcaSubmissionId) {
      await this.zatcaSubmissionService.submitAfterPost(companyId, posted.zatcaSubmissionId, userId);
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
        lines: true,
        businessPartner: true,
        zatcaSubmission: {
          select: { id: true, status: true, icv: true, uuid: true, invoiceKind: true, qrCode: true, warnings: true, errors: true },
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
