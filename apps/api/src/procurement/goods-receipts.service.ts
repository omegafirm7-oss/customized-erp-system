import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, GoodsReceiptStatus, Prisma, PurchaseOrderStatus, QualityCheckResult } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { CreateGoodsReceiptDto, RecordQcDto, UpdateReceiptLineDto } from "./dto/procurement.dtos";

/**
 * Receiving + QC record against a Purchase Order. Deliberately does NOT
 * call InventoryService.receiveStock() or touch the GL — stock still
 * enters the system at PurchaseInvoice posting time exactly as before (see
 * ap.service.ts::post). This document exists purely to capture what was
 * physically received/accepted so PurchaseOrdersService.getThreeWayMatchWarning
 * can show a non-blocking mismatch banner on the invoice-generation screen.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, purchaseOrderId?: string) {
    return this.prisma.goodsReceipt.findMany({
      where: { companyId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { purchaseOrder: { select: { orderNumber: true } }, warehouse: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  /** Prefills one line per PO line that still has quantity remaining to receive. */
  async create(companyId: string, userId: string, dto: CreateGoodsReceiptDto) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, companyId },
      include: { lines: true },
    });
    if (!order) {
      throw new NotFoundException("Purchase order not found");
    }
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException("This purchase order is cancelled");
    }
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, companyId } });
    if (!warehouse) {
      throw new NotFoundException("Warehouse not found");
    }
    const linesToReceive = order.lines.filter((l) => l.quantity.sub(l.receivedQuantity).gt(0));
    if (linesToReceive.length === 0) {
      throw new BadRequestException("Nothing left to receive on this purchase order");
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.GOODS_RECEIPT,
        fiscalYearId: null,
      });
      return tx.goodsReceipt.create({
        data: {
          companyId,
          receiptNumber,
          purchaseOrderId: order.id,
          warehouseId: dto.warehouseId,
          receivedDate: new Date(dto.receivedDate),
          receivedByUserId: userId,
          memo: dto.memo,
          lines: {
            create: linesToReceive.map((line) => ({
              purchaseOrderLineId: line.id,
              quantityReceived: line.quantity.sub(line.receivedQuantity),
            })),
          },
        },
        include: { lines: { include: { purchaseOrderLine: true } }, warehouse: true, purchaseOrder: true },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "GoodsReceipt",
      entityId: receipt.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: receipt,
    });
    return receipt;
  }

  async updateLine(companyId: string, receiptId: string, lineId: string, dto: UpdateReceiptLineDto) {
    const receipt = await this.getDraft(companyId, receiptId);
    const line = receipt.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException("Goods receipt line not found");
    }
    await this.prisma.goodsReceiptLine.update({
      where: { id: lineId },
      data: { quantityReceived: new Prisma.Decimal(dto.quantityReceived) },
    });
    return this.get(companyId, receiptId);
  }

  /** DRAFT → QC_PENDING; locks received quantities. */
  async submitForQc(companyId: string, id: string, userId: string) {
    const before = await this.getDraft(companyId, id);
    if (before.lines.every((l) => l.quantityReceived.lte(0))) {
      throw new BadRequestException("No quantities recorded to submit for QC");
    }
    const updated = await this.prisma.goodsReceipt.update({
      where: { id },
      data: { status: GoodsReceiptStatus.QC_PENDING },
    });
    await this.auditService.log({
      companyId,
      entityName: "GoodsReceipt",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: updated.status },
    });
    return updated;
  }

  async recordQc(companyId: string, receiptId: string, lineId: string, userId: string, dto: RecordQcDto) {
    const receipt = await this.getOwned(companyId, receiptId);
    if (receipt.status !== GoodsReceiptStatus.QC_PENDING) {
      throw new ConflictException("Only receipts pending QC can have results recorded");
    }
    const line = receipt.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException("Goods receipt line not found");
    }
    const accepted = new Prisma.Decimal(dto.quantityAccepted);
    const rejected = new Prisma.Decimal(dto.quantityRejected);
    if (accepted.add(rejected).gt(line.quantityReceived)) {
      throw new BadRequestException("Accepted + rejected cannot exceed quantity received");
    }
    await this.prisma.goodsReceiptLine.update({
      where: { id: lineId },
      data: { qcResult: dto.qcResult, quantityAccepted: accepted, quantityRejected: rejected, qcNotes: dto.qcNotes },
    });
    await this.auditService.log({
      companyId,
      entityName: "GoodsReceiptLine",
      entityId: lineId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { qcResult: dto.qcResult, quantityAccepted: dto.quantityAccepted, quantityRejected: dto.quantityRejected },
    });
    return this.get(companyId, receiptId);
  }

  /**
   * QC_PENDING → COMPLETED. Bumps PurchaseOrderLine.receivedQuantity by
   * each line's quantityReceived (not quantityAccepted — a rejected item was
   * still physically received; the accepted/rejected split only feeds the
   * three-way-match warning, it doesn't gate what counts as "received").
   */
  async complete(companyId: string, id: string, userId: string) {
    const receipt = await this.getOwned(companyId, id);
    if (receipt.status !== GoodsReceiptStatus.QC_PENDING) {
      throw new ConflictException("Only receipts pending QC can be completed");
    }
    if (receipt.lines.some((l) => l.qcResult === QualityCheckResult.PENDING)) {
      throw new BadRequestException("Every line needs a QC result before completing this receipt");
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of receipt.lines) {
        await tx.purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: { receivedQuantity: { increment: line.quantityReceived } },
        });
      }
      await tx.goodsReceipt.update({
        where: { id },
        data: { status: GoodsReceiptStatus.COMPLETED, qcByUserId: userId, qcAt: new Date() },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "GoodsReceipt",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: receipt.status },
      afterSnapshot: { status: GoodsReceiptStatus.COMPLETED },
    });
    return this.get(companyId, id);
  }

  private async getOwned(companyId: string, id: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, companyId },
      include: {
        lines: { include: { purchaseOrderLine: true } },
        warehouse: { select: { code: true, name: true } },
        purchaseOrder: { select: { orderNumber: true, businessPartner: { select: { code: true, name: true } } } },
      },
    });
    if (!receipt) {
      throw new NotFoundException("Goods receipt not found");
    }
    return receipt;
  }

  private async getDraft(companyId: string, id: string) {
    const receipt = await this.getOwned(companyId, id);
    if (receipt.status !== GoodsReceiptStatus.DRAFT) {
      throw new ConflictException(`Goods receipt is ${receipt.status} — only drafts can be modified`);
    }
    return receipt;
  }
}
