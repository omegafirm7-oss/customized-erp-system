import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, PartnerType, SalesOrderStatus, SalesQuotationStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { ArService } from "./ar.service";
import { InvoiceLineDto } from "./dto/invoice-line.dto";
import { CreateSalesOrderDto, GenerateSalesInvoiceDto } from "./dto/create-sales-order.dto";
import { SalesQuotationsService } from "./sales-quotations.service";

/**
 * Second stage of the sales cycle, mirroring PurchaseOrdersService exactly
 * on the customer side. A Sales Order is a commitment, not yet a
 * transaction — like a Quotation, it never posts to the GL; only the
 * SalesInvoice generated from it does (via ArService.createDraft,
 * unchanged). One order can be invoiced across several SalesInvoices
 * (partial delivery/billing), tracked per-line via `invoicedQuantity`.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
    private readonly arService: ArService,
    private readonly quotationsService: SalesQuotationsService,
  ) {}

  async list(companyId: string, status?: SalesOrderStatus) {
    return this.prisma.salesOrder.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: true, businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreateSalesOrderDto) {
    const partner = await this.getCustomer(companyId, dto.businessPartnerId);
    return this.createRow(companyId, userId, partner.id, dto, null);
  }

  /** Copies the quotation's lines onto a new order and marks the quotation CONVERTED. */
  async createFromQuotation(companyId: string, userId: string, quotationId: string) {
    const quotation = await this.quotationsService.get(companyId, quotationId);
    if (quotation.status === SalesQuotationStatus.CONVERTED) {
      throw new ConflictException("This quotation has already been converted to a sales order");
    }
    if (quotation.status === SalesQuotationStatus.CANCELLED) {
      throw new ConflictException("Cannot convert a cancelled quotation");
    }

    const dto: CreateSalesOrderDto = {
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
    // generate-invoice pattern (see SalesQuotationsService.markConverted).
    await this.quotationsService.markConverted(companyId, quotation.id, userId);
    return order;
  }

  private async createRow(
    companyId: string,
    userId: string,
    businessPartnerId: string,
    dto: CreateSalesOrderDto,
    sourceQuotationId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.SALES_ORDER,
        fiscalYearId: null,
      });
      const order = await tx.salesOrder.create({
        data: {
          companyId,
          orderNumber,
          businessPartnerId,
          sourceQuotationId,
          orderDate: new Date(dto.orderDate),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          status: SalesOrderStatus.CONFIRMED,
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
        entityName: "SalesOrder",
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
    if (before.status === SalesOrderStatus.INVOICED) {
      throw new ConflictException("This sales order is fully invoiced and cannot be cancelled");
    }
    if (before.status === SalesOrderStatus.CANCELLED) {
      throw new ConflictException("This sales order is already cancelled");
    }
    if (before.lines.some((l) => l.invoicedQuantity.gt(0))) {
      throw new ConflictException("This sales order has been partially invoiced — cancel remaining lines individually is not supported yet");
    }
    const cancelled = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.CANCELLED },
      include: { lines: true, businessPartner: true },
    });
    await this.auditService.log({
      companyId,
      entityName: "SalesOrder",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });
    return cancelled;
  }

  /**
   * Converts whatever remains uninvoiced on this order into a single
   * SalesInvoice draft (ArService.createDraft, unchanged except for the new
   * optional salesOrderId stamp). Mirrors PurchaseOrdersService.generateInvoice:
   * create the invoice as its own transaction, then optimistically flip the
   * source document's quantities/status in a second write, throwing if a
   * concurrent call raced ahead.
   */
  async generateInvoice(companyId: string, orderId: string, userId: string, dto: GenerateSalesInvoiceDto) {
    const order = await this.getOwned(companyId, orderId);
    if (order.status === SalesOrderStatus.CANCELLED) {
      throw new ConflictException("This sales order is cancelled");
    }
    if (order.status === SalesOrderStatus.INVOICED) {
      throw new ConflictException("This sales order is already fully invoiced");
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
      throw new BadRequestException("Nothing left to invoice on this sales order");
    }

    const invoice = await this.arService.createDraft(companyId, userId, {
      businessPartnerId: order.businessPartnerId,
      issueDateTime: dto.issueDateTime,
      postingDate: dto.postingDate,
      dueDate: dto.dueDate,
      memo: dto.memo ?? `Sales order ${order.orderNumber}`,
      lines: invoiceLines,
      salesOrderId: order.id,
    });

    // Optimistic per-line update: each matches on the invoicedQuantity we
    // just read, so a concurrent generateInvoice() call against the same
    // line loses the race cleanly instead of silently double-invoicing.
    let allRacesOk = true;
    for (const line of order.lines) {
      const delta = remainingByLine.get(line.id);
      if (!delta) continue;
      const updated = await this.prisma.salesOrderLine.updateMany({
        where: { id: line.id, invoicedQuantity: delta.oldInvoiced },
        data: { invoicedQuantity: line.quantity },
      });
      if (updated.count === 0) allRacesOk = false;
    }
    if (!allRacesOk) {
      throw new ConflictException(
        "This sales order changed while generating the invoice — the invoice was created, but its lines could not be marked invoiced; please review manually",
      );
    }

    const refreshed = await this.prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const fullyInvoiced = refreshed.lines.every((l) => l.quantity.sub(l.invoicedQuantity).lte(0));
    await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: fullyInvoiced ? SalesOrderStatus.INVOICED : SalesOrderStatus.PARTIALLY_INVOICED },
    });

    await this.auditService.log({
      companyId,
      entityName: "SalesOrder",
      entityId: orderId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { generatedInvoiceId: invoice.id, status: fullyInvoiced ? SalesOrderStatus.INVOICED : SalesOrderStatus.PARTIALLY_INVOICED },
    });

    return invoice;
  }

  private async getOwned(companyId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: true } }, businessPartner: true },
    });
    if (!order) {
      throw new NotFoundException("Sales order not found");
    }
    return order;
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
}
