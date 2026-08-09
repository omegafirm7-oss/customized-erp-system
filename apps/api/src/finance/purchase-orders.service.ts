import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, PartnerType, PurchaseOrderStatus, PurchaseQuotationStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { ApService } from "./ap.service";
import { InvoiceLineDto } from "./dto/invoice-line.dto";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { GeneratePurchaseInvoiceDto } from "./dto/create-purchase-order.dto";
import { PurchaseQuotationsService } from "./purchase-quotations.service";

/**
 * Second stage of the purchasing cycle. A Purchase Order is a commitment,
 * not yet a transaction — like a Quotation, it never posts to the GL; only
 * the PurchaseInvoice generated from it does (via ApService.createDraft,
 * unchanged). One PO can be invoiced across several PurchaseInvoices
 * (partial delivery/billing), tracked per-line via `invoicedQuantity`.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
    private readonly apService: ApService,
    private readonly quotationsService: PurchaseQuotationsService,
  ) {}

  async list(companyId: string, status?: PurchaseOrderStatus) {
    return this.prisma.purchaseOrder.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: true, businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreatePurchaseOrderDto) {
    const partner = await this.getVendor(companyId, dto.businessPartnerId);
    return this.createRow(companyId, userId, partner.id, dto, null);
  }

  /** Copies the quotation's lines onto a new PO and marks the quotation CONVERTED. */
  async createFromQuotation(companyId: string, userId: string, quotationId: string) {
    const quotation = await this.quotationsService.get(companyId, quotationId);
    if (quotation.status === PurchaseQuotationStatus.CONVERTED) {
      throw new ConflictException("This quotation has already been converted to a purchase order");
    }
    if (quotation.status === PurchaseQuotationStatus.CANCELLED) {
      throw new ConflictException("Cannot convert a cancelled quotation");
    }

    const dto: CreatePurchaseOrderDto = {
      businessPartnerId: quotation.businessPartnerId,
      orderDate: new Date().toISOString(),
      lines: quotation.lines.map((line) => ({
        itemId: line.itemId ?? undefined,
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        vatCategory: line.vatCategory ?? undefined,
      })),
    };

    const order = await this.createRow(companyId, userId, quotation.businessPartnerId, dto, quotation.id);
    // Separate write, optimistically checked — mirrors the two-phase
    // generate-invoice pattern (see PurchaseQuotationsService.markConverted).
    await this.quotationsService.markConverted(companyId, quotation.id, userId);
    return order;
  }

  private async createRow(
    companyId: string,
    userId: string,
    businessPartnerId: string,
    dto: CreatePurchaseOrderDto,
    sourceQuotationId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.PURCHASE_ORDER,
        fiscalYearId: null,
      });
      const order = await tx.purchaseOrder.create({
        data: {
          companyId,
          orderNumber,
          businessPartnerId,
          sourceQuotationId,
          orderDate: new Date(dto.orderDate),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          status: PurchaseOrderStatus.SENT,
          memo: dto.memo,
          createdByUserId: userId,
          lines: {
            create: dto.lines.map((line, idx) => ({
              lineNumber: idx + 1,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatCategory: line.vatCategory,
              warehouseId: line.warehouseId,
              costCenterId: line.costCenterId,
            })),
          },
        },
        include: { lines: true, businessPartner: true },
      });

      await this.auditService.log({
        companyId,
        entityName: "PurchaseOrder",
        entityId: order.id,
        action: "CREATE",
        changedByUserId: userId,
        afterSnapshot: order,
      });

      return order;
    });
  }

  async cancel(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status === PurchaseOrderStatus.INVOICED) {
      throw new ConflictException("This purchase order is fully invoiced and cannot be cancelled");
    }
    if (before.status === PurchaseOrderStatus.CANCELLED) {
      throw new ConflictException("This purchase order is already cancelled");
    }
    if (before.lines.some((l) => l.invoicedQuantity.gt(0))) {
      throw new ConflictException("This purchase order has been partially invoiced — cancel remaining lines individually is not supported yet");
    }
    const cancelled = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
      include: { lines: true, businessPartner: true },
    });
    await this.auditService.log({
      companyId,
      entityName: "PurchaseOrder",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });
    return cancelled;
  }

  /**
   * Converts whatever remains uninvoiced on this PO into a single
   * PurchaseInvoice draft (ApService.createDraft, unchanged except for the
   * new optional purchaseOrderId stamp). Mirrors
   * manpower/billing.service.ts generateInvoice(): create the invoice as
   * its own transaction, then optimistically flip the source document's
   * quantities/status in a second write, throwing if a concurrent call
   * raced ahead.
   */
  async generateInvoice(companyId: string, orderId: string, userId: string, dto: GeneratePurchaseInvoiceDto) {
    const order = await this.getOwned(companyId, orderId);
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new ConflictException("This purchase order is cancelled");
    }
    if (order.status === PurchaseOrderStatus.INVOICED) {
      throw new ConflictException("This purchase order is already fully invoiced");
    }

    const invoiceLines: InvoiceLineDto[] = [];
    const remainingByLine = new Map<string, { remaining: string; oldInvoiced: string }>();
    for (const line of order.lines) {
      const remaining = line.quantity.sub(line.invoicedQuantity);
      if (remaining.lte(0)) continue;
      invoiceLines.push({
        itemId: line.itemId ?? undefined,
        description: line.description,
        quantity: remaining.toString(),
        unitPrice: line.unitPrice.toString(),
        vatCategory: line.vatCategory ?? undefined,
        warehouseId: line.warehouseId ?? undefined,
        costCenterId: line.costCenterId ?? undefined,
      });
      remainingByLine.set(line.id, { remaining: remaining.toString(), oldInvoiced: line.invoicedQuantity.toString() });
    }
    if (invoiceLines.length === 0) {
      throw new BadRequestException("Nothing left to invoice on this purchase order");
    }

    const invoice = await this.apService.createDraft(companyId, userId, {
      businessPartnerId: order.businessPartnerId,
      vendorInvoiceNumber: dto.vendorInvoiceNumber,
      postingDate: dto.postingDate,
      dueDate: dto.dueDate,
      memo: dto.memo ?? `Purchase order ${order.orderNumber}`,
      lines: invoiceLines,
      purchaseOrderId: order.id,
    });

    // Optimistic per-line update: each matches on the invoicedQuantity we
    // just read, so a concurrent generateInvoice() call against the same
    // line loses the race cleanly instead of silently double-invoicing.
    let allRacesOk = true;
    for (const line of order.lines) {
      const delta = remainingByLine.get(line.id);
      if (!delta) continue;
      const updated = await this.prisma.purchaseOrderLine.updateMany({
        where: { id: line.id, invoicedQuantity: delta.oldInvoiced },
        data: { invoicedQuantity: line.quantity },
      });
      if (updated.count === 0) allRacesOk = false;
    }
    if (!allRacesOk) {
      throw new ConflictException(
        "This purchase order changed while generating the invoice — the invoice was created, but its lines could not be marked invoiced; please review manually",
      );
    }

    const refreshed = await this.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const fullyInvoiced = refreshed.lines.every((l) => l.quantity.sub(l.invoicedQuantity).lte(0));
    await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: fullyInvoiced ? PurchaseOrderStatus.INVOICED : PurchaseOrderStatus.PARTIALLY_INVOICED },
    });

    await this.auditService.log({
      companyId,
      entityName: "PurchaseOrder",
      entityId: orderId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { generatedInvoiceId: invoice.id, status: fullyInvoiced ? PurchaseOrderStatus.INVOICED : PurchaseOrderStatus.PARTIALLY_INVOICED },
    });

    return invoice;
  }

  private async getOwned(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: true } }, businessPartner: true },
    });
    if (!order) {
      throw new NotFoundException("Purchase order not found");
    }
    return order;
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
}
