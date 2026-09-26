import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { FbrSubmissionStatus, JournalSourceModule, PaymentDirection, PosTerminal, Prisma, SalesDocumentKind } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { ArService } from "../finance/ar.service";
import { PaymentsService } from "../finance/payments.service";
import { GlPostingService } from "../gl/gl-posting.service";
import { POS_INVOICE_TYPES, POS_PAYMENT_MODES } from "../fbr/fbr-constants";
import { CreatePosReturnDto, CreatePosSaleDto } from "./dto/pos.dto";

type Terminal = PosTerminal;

/** Pakistan calendar date (UTC+5, no DST) of an instant, as YYYY-MM-DD. */
function pkDate(instant: Date): string {
  return new Date(instant.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Inbound sales from the client's POS software. Each sale becomes a real,
 * posted SalesInvoice (so GL, COGS/stock, tax register all just work),
 * settled immediately by a receipt into the till's cash/card account, and
 * reported to FBR IMS by the AR posting hook (channel POS). The POS gets
 * the FBR fiscal invoice number back synchronously to print on the receipt.
 *
 * Idempotent per (terminal, clientSaleId): a till that times out and
 * resends gets the same result, never a duplicate sale.
 */
@Injectable()
export class PosSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arService: ArService,
    private readonly paymentsService: PaymentsService,
    private readonly glPostingService: GlPostingService,
  ) {}

  async recordSale(terminal: Terminal, dto: CreatePosSaleDto) {
    const existing = await this.findByClientId(terminal, dto.clientSaleId);
    if (existing) return this.settleAndPresent(terminal, existing.id);

    const { company, settings } = await this.requireReady(terminal);
    const itemByCode = await this.loadItems(terminal.companyId, dto.lines.map((l) => l.itemCode));
    const at = dto.dateTime ? new Date(dto.dateTime) : new Date();
    const day = pkDate(at);

    return this.createAndPost(terminal, {
      clientSaleId: dto.clientSaleId,
      invoiceType: POS_INVOICE_TYPES.NEW,
      paymentMode: dto.paymentMode,
      posFee: settings.posFeeAmount,
      rawPayload: dto,
      draft: {
        businessPartnerId: terminal.walkInPartnerId,
        issueDateTime: at.toISOString(),
        postingDate: day,
        dueDate: day,
        currencyCode: company.baseCurrencyCode,
        memo: `POS ${terminal.code} sale ${dto.clientSaleId}`,
        lines: dto.lines.map((line) => {
          const item = itemByCode.get(line.itemCode)!;
          return {
            itemId: item.id,
            description: item.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount ?? "0",
            taxMode: dto.pricesIncludeTax === false ? ("EXCLUSIVE" as const) : ("INCLUSIVE" as const),
            warehouseId: item.isInventoryItem ? terminal.warehouseId ?? undefined : undefined,
            costCenterId: terminal.costCenterId ?? undefined,
          };
        }),
      },
    });
  }

  async recordReturn(terminal: Terminal, originalClientSaleId: string, dto: CreatePosReturnDto) {
    const existing = await this.findByClientId(terminal, dto.clientSaleId);
    if (existing) return this.settleAndPresent(terminal, existing.id);

    const { company } = await this.requireReady(terminal);
    const original = await this.prisma.posSale.findUnique({
      where: { terminalId_clientSaleId: { terminalId: terminal.id, clientSaleId: originalClientSaleId } },
      include: { salesInvoice: { include: { lines: { include: { item: true } }, fbrSubmission: true } } },
    });
    if (!original || original.invoiceType !== POS_INVOICE_TYPES.NEW) {
      throw new NotFoundException(`Original sale "${originalClientSaleId}" not found on this terminal`);
    }

    // Price each returned item exactly as it was sold (per-unit share of
    // the original line's gross, discounts included).
    const lines = dto.lines.map((line) => {
      const soldLine = original.salesInvoice.lines.find((l) => l.item?.code === line.itemCode);
      if (!soldLine) throw new BadRequestException(`Item ${line.itemCode} was not on sale ${originalClientSaleId}`);
      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0) || quantity.gt(soldLine.quantity)) {
        throw new BadRequestException(`Return quantity for ${line.itemCode} must be between 0 and ${soldLine.quantity}`);
      }
      return {
        itemId: soldLine.itemId!,
        description: soldLine.description,
        quantity: line.quantity,
        unitPrice: soldLine.grossAmount.div(soldLine.quantity).toDecimalPlaces(4).toString(),
        discountAmount: "0",
        taxMode: "INCLUSIVE" as const,
        warehouseId: soldLine.warehouseId ?? undefined,
        costCenterId: soldLine.costCenterId ?? undefined,
      };
    });

    const at = dto.dateTime ? new Date(dto.dateTime) : new Date();
    const day = pkDate(at);
    return this.createAndPost(terminal, {
      clientSaleId: dto.clientSaleId,
      invoiceType: POS_INVOICE_TYPES.CREDIT,
      refPosSaleId: original.id,
      paymentMode: original.paymentMode,
      posFee: new Prisma.Decimal(0),
      rawPayload: { ...dto, originalClientSaleId },
      refundAccountId: this.tenderAccount(terminal, original.paymentMode),
      draft: {
        documentKind: SalesDocumentKind.CREDIT_NOTE,
        originalInvoiceId: original.salesInvoiceId,
        businessPartnerId: original.salesInvoice.businessPartnerId,
        issueDateTime: at.toISOString(),
        postingDate: day,
        dueDate: day,
        currencyCode: company.baseCurrencyCode,
        memo: `POS ${terminal.code} return ${dto.clientSaleId} of ${originalClientSaleId}`,
        lines,
      },
    });
  }

  /** A terminal's sales for one Pakistan-local day, newest first (counter screen). */
  async listSales(terminal: Terminal, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("date must be YYYY-MM-DD");
    const sales = await this.prisma.posSale.findMany({
      where: { terminalId: terminal.id, salesInvoice: { postingDate: new Date(`${date}T00:00:00Z`) } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return Promise.all(sales.map((sale) => this.present(sale.id)));
  }

  async listSellableItems(companyId: string) {
    return this.prisma.item.findMany({
      where: { companyId, isActive: true, isSalesItem: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, itemType: true, vatCategory: true, hsCode: true, defaultSalesPrice: true },
    });
  }

  async getSale(terminal: Terminal, clientSaleId: string) {
    const sale = await this.findByClientId(terminal, clientSaleId);
    if (!sale) throw new NotFoundException(`Sale "${clientSaleId}" not found on this terminal`);
    return this.settleAndPresent(terminal, sale.id);
  }

  // ── internals ──────────────────────────────────────────────────────

  private async createAndPost(
    terminal: Terminal,
    input: {
      clientSaleId: string;
      invoiceType: number;
      refPosSaleId?: string;
      paymentMode: number;
      posFee: Prisma.Decimal;
      rawPayload: object;
      refundAccountId?: string;
      draft: Parameters<ArService["createDraft"]>[2];
    },
  ) {
    const actor = terminal.createdByUserId;
    const draft = await this.arService.createDraft(terminal.companyId, actor, input.draft);

    let posSaleId: string | null = null;
    try {
      const posSale = await this.prisma.posSale.create({
        data: {
          companyId: terminal.companyId,
          terminalId: terminal.id,
          clientSaleId: input.clientSaleId,
          invoiceType: input.invoiceType,
          refPosSaleId: input.refPosSaleId,
          paymentMode: input.paymentMode,
          posFee: input.posFee,
          salesInvoiceId: draft.id,
          rawPayload: input.rawPayload as Prisma.InputJsonValue,
        },
      });
      posSaleId = posSale.id;
      // Posting reports to FBR IMS (the hook sees the PosSale → POS channel).
      await this.arService.postInvoice(terminal.companyId, draft.id, actor, false, { cashRefundAccountId: input.refundAccountId });
    } catch (error) {
      // Compensate: never leave a draft or orphan PosSale behind.
      if (posSaleId) await this.prisma.posSale.delete({ where: { id: posSaleId } }).catch(() => undefined);
      await this.prisma.salesInvoice.delete({ where: { id: draft.id } }).catch(() => undefined);
      if (isUniqueViolation(error)) {
        // A concurrent resend of the same clientSaleId won the race.
        const winner = await this.findByClientId(terminal, input.clientSaleId);
        if (winner) return this.settleAndPresent(terminal, winner.id);
      }
      throw error;
    }
    return this.settleAndPresent(terminal, posSaleId);
  }

  /**
   * Receipt + POS-fee entry, each done at most once — safe to call again on
   * an idempotent resend if a previous attempt died halfway.
   */
  private async settleAndPresent(terminal: Terminal, posSaleId: string) {
    let sale = await this.prisma.posSale.findUniqueOrThrow({ where: { id: posSaleId }, include: { salesInvoice: true } });
    const invoice = sale.salesInvoice;
    const isReturn = sale.invoiceType === POS_INVOICE_TYPES.CREDIT;
    const tender = this.tenderAccount(terminal, sale.paymentMode);

    // Sales: settle the invoice from the till. Returns were already posted
    // straight to the till cash account (credit note cash refund).
    if (!isReturn && !sale.paymentId && invoice.openAmount.gt(0)) {
      const payment = await this.paymentsService.createPayment(terminal.companyId, terminal.createdByUserId, PaymentDirection.INCOMING, {
        businessPartnerId: invoice.businessPartnerId,
        paymentDate: invoice.postingDate.toISOString().slice(0, 10),
        bankCashAccountId: tender,
        amount: invoice.openAmount.toString(),
        reference: invoice.invoiceNumber ?? undefined,
        memo: `POS ${terminal.code} ${sale.clientSaleId}`,
        allocations: [{ invoiceId: invoice.id, amount: invoice.openAmount.toString() }],
      });
      sale = await this.prisma.posSale.update({ where: { id: sale.id }, data: { paymentId: payment.id }, include: { salesInvoice: true } });
    }

    // FBR POS service fee: collected on top of the bill, owed to FBR.
    if (sale.posFee.gt(0)) {
      const alreadyBooked = await this.prisma.journalEntry.findFirst({
        where: { companyId: terminal.companyId, sourceModule: JournalSourceModule.AR, sourceDocumentId: sale.id },
        select: { id: true },
      });
      if (!alreadyBooked) {
        const settings = await this.prisma.fbrSettings.findUniqueOrThrow({ where: { companyId: terminal.companyId } });
        const company = await this.prisma.company.findUniqueOrThrow({ where: { id: terminal.companyId } });
        await this.prisma.$transaction((tx) =>
          this.glPostingService.createPostedEntry(tx, {
            companyId: terminal.companyId,
            userId: terminal.createdByUserId,
            postingDate: invoice.postingDate,
            documentDate: invoice.issueDateTime,
            currencyCode: company.baseCurrencyCode,
            exchangeRateToFunctional: new Prisma.Decimal(1),
            sourceModule: JournalSourceModule.AR,
            sourceDocumentId: sale.id,
            memo: `FBR POS fee — ${invoice.invoiceNumber}`,
            lines: [
              { accountId: tender, debit: sale.posFee, credit: new Prisma.Decimal(0), amountInTransactionCurrency: sale.posFee, description: "POS fee collected" },
              { accountId: settings.posFeeAccountId!, debit: new Prisma.Decimal(0), credit: sale.posFee, amountInTransactionCurrency: sale.posFee, description: "FBR POS fee payable" },
            ],
          }),
        );
      }
    }

    return this.present(sale.id);
  }

  private async present(posSaleId: string) {
    const sale = await this.prisma.posSale.findUniqueOrThrow({
      where: { id: posSaleId },
      include: { salesInvoice: { include: { fbrSubmission: true, lines: { orderBy: { lineNumber: "asc" }, include: { item: { select: { code: true } } } } } } },
    });
    const invoice = sale.salesInvoice;
    const buyer = (sale.rawPayload as { buyer?: { name?: string; ntnCnic?: string; phone?: string } } | null)?.buyer ?? null;
    const submission = invoice.fbrSubmission;
    const salesTax = invoice.vatTotal.sub(invoice.furtherTaxTotal);
    return {
      clientSaleId: sale.clientSaleId,
      type: sale.invoiceType === POS_INVOICE_TYPES.CREDIT ? "RETURN" : "SALE",
      erpInvoiceNumber: invoice.invoiceNumber,
      usin: invoice.invoiceNumber,
      dateTime: invoice.issueDateTime.toISOString(),
      paymentMode: sale.paymentMode,
      buyer,
      lines: invoice.lines.map((l) => ({
        itemCode: l.item?.code ?? null,
        description: l.description,
        quantity: l.quantity.toString(),
        taxRate: l.vatRate.toString(),
        netAmount: l.netAmount.toString(),
        taxAmount: l.vatAmount.toString(),
        amount: l.grossAmount.toString(),
      })),
      fbr: {
        status: submission?.status ?? "NOT_REPORTED",
        environment: submission?.environment ?? null,
        invoiceNumber: submission?.fbrInvoiceNumber ?? null,
        // Print as a QR on the receipt (FBR "Verify Invoice" app scans it).
        qrPayload: submission?.status === FbrSubmissionStatus.VALID ? submission.fbrInvoiceNumber : null,
        errors: submission?.errors ?? null,
      },
      totals: {
        saleValue: invoice.netTotal.toString(),
        salesTax: salesTax.toString(),
        furtherTax: invoice.furtherTaxTotal.toString(),
        total: invoice.grossTotal.toString(),
        posFee: sale.posFee.toString(),
        amountPayable: invoice.grossTotal.add(sale.posFee).toString(),
      },
    };
  }

  private tenderAccount(terminal: Terminal, paymentMode: number) {
    return paymentMode === POS_PAYMENT_MODES.CARD && terminal.cardAccountId ? terminal.cardAccountId : terminal.cashAccountId;
  }

  private findByClientId(terminal: Terminal, clientSaleId: string) {
    return this.prisma.posSale.findUnique({ where: { terminalId_clientSaleId: { terminalId: terminal.id, clientSaleId } } });
  }

  private async requireReady(terminal: Terminal) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: terminal.companyId } });
    const settings = await this.prisma.fbrSettings.findUnique({ where: { companyId: terminal.companyId } });
    if (!settings?.enabled) {
      throw new ConflictException("FBR reporting is not enabled for this company — sales cannot be accepted");
    }
    if (settings.posFeeAmount.gt(0) && !settings.posFeeAccountId) {
      throw new ConflictException("FBR POS fee account is not configured (FBR settings)");
    }
    return { company, settings };
  }

  private async loadItems(companyId: string, codes: string[]) {
    const unique = [...new Set(codes)];
    const items = await this.prisma.item.findMany({ where: { companyId, code: { in: unique }, isActive: true, isSalesItem: true } });
    const byCode = new Map(items.map((item) => [item.code, item]));
    const missing = unique.filter((code) => !byCode.has(code));
    if (missing.length) throw new BadRequestException(`Unknown or inactive item code(s): ${missing.join(", ")}`);
    return byCode;
  }
}
