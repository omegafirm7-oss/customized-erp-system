import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DeliveryNoteStatus, DocumentType, Prisma, SalesOrderStatus } from "@prisma/client";
import { IsDateString, IsNumberString, IsOptional, IsString } from "class-validator";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";

export class CreateDeliveryNoteDto {
  @IsString()
  salesOrderId!: string;

  @IsDateString()
  deliveryDate!: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateDeliveryNoteDto {
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateDeliveryLineDto {
  @IsNumberString()
  quantity!: string;
}

export class MarkDeliveredDto {
  @IsString()
  receivedByName!: string;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string;
}

// Orders that are confirmed commitments: goods may go out against them.
const DELIVERABLE: SalesOrderStatus[] = [SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_INVOICED, SalesOrderStatus.INVOICED];

/**
 * Delivery Note against a Sales Order — the sales-side twin of GoodsReceipt. A document only: it records what left,
 * who drove it and who signed for it, but never moves stock or posts to the GL (stock still leaves at sales-invoice
 * posting, exactly as before). Quantities already on a live (non-cancelled) delivery note are not offered again.
 */
@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, salesOrderId?: string) {
    return this.prisma.deliveryNote.findMany({
      where: { companyId, ...(salesOrderId ? { salesOrderId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { salesOrder: { select: { orderNumber: true, businessPartner: { select: { code: true, name: true } } } } },
    });
  }

  async get(companyId: string, id: string) {
    const note = await this.getOwned(companyId, id);
    const delivered = await this.deliveredByLine(companyId, note.lines.map((l) => l.salesOrderLineId), note.id);
    return {
      ...note,
      lines: note.lines.map((l) => ({
        ...l,
        orderedQuantity: l.salesOrderLine.quantity,
        // Delivered on OTHER live notes — what this one may still take from the order.
        deliveredElsewhere: delivered.get(l.salesOrderLineId) ?? new Prisma.Decimal(0),
      })),
    };
  }

  /** Prefills one line per order line that still has quantity left to deliver. */
  async create(companyId: string, userId: string, dto: CreateDeliveryNoteDto) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: dto.salesOrderId, companyId }, include: { lines: true } });
    if (!order) throw new NotFoundException("Sales order not found");
    if (!DELIVERABLE.includes(order.status)) {
      throw new BadRequestException(`A ${order.status.toLowerCase().replace(/_/g, " ")} sales order cannot be delivered against — confirm it first`);
    }
    const delivered = await this.deliveredByLine(companyId, order.lines.map((l) => l.id));
    const remaining = order.lines
      .map((l) => ({ line: l, left: l.quantity.sub(delivered.get(l.id) ?? 0) }))
      .filter((r) => r.left.gt(0));
    if (remaining.length === 0) throw new BadRequestException("Everything on this sales order is already on a delivery note");

    const note = await this.prisma.$transaction(async (tx) => {
      const deliveryNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.DELIVERY_NOTE,
        fiscalYearId: null,
      });
      return tx.deliveryNote.create({
        data: {
          companyId,
          deliveryNumber,
          salesOrderId: order.id,
          deliveryDate: new Date(dto.deliveryDate),
          deliveryAddress: dto.deliveryAddress,
          memo: dto.memo,
          createdByUserId: userId,
          lines: { create: remaining.map((r) => ({ salesOrderLineId: r.line.id, quantity: r.left })) },
        },
      });
    });
    await this.auditService.log({ companyId, entityName: "DeliveryNote", entityId: note.id, action: "CREATE", changedByUserId: userId, afterSnapshot: note });
    return this.get(companyId, note.id);
  }

  async update(companyId: string, id: string, userId: string, dto: UpdateDeliveryNoteDto) {
    await this.getDraft(companyId, id);
    await this.prisma.deliveryNote.update({
      where: { id },
      data: {
        ...(dto.deliveryDate ? { deliveryDate: new Date(dto.deliveryDate) } : {}),
        ...(dto.deliveryAddress !== undefined ? { deliveryAddress: dto.deliveryAddress || null } : {}),
        ...(dto.vehicleNumber !== undefined ? { vehicleNumber: dto.vehicleNumber || null } : {}),
        ...(dto.driverName !== undefined ? { driverName: dto.driverName || null } : {}),
        ...(dto.memo !== undefined ? { memo: dto.memo || null } : {}),
      },
    });
    await this.auditService.log({ companyId, entityName: "DeliveryNote", entityId: id, action: "UPDATE", changedByUserId: userId, afterSnapshot: dto });
    return this.get(companyId, id);
  }

  async updateLine(companyId: string, id: string, lineId: string, dto: UpdateDeliveryLineDto) {
    const note = await this.getDraft(companyId, id);
    const line = note.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Delivery note line not found");
    const quantity = new Prisma.Decimal(dto.quantity);
    if (quantity.lt(0)) throw new BadRequestException("Quantity cannot be negative");
    const elsewhere = (await this.deliveredByLine(companyId, [line.salesOrderLineId], id)).get(line.salesOrderLineId) ?? new Prisma.Decimal(0);
    const room = line.salesOrderLine.quantity.sub(elsewhere);
    if (quantity.gt(room)) throw new BadRequestException(`Only ${room.toString()} left to deliver on this order line`);
    await this.prisma.deliveryNoteLine.update({ where: { id: lineId }, data: { quantity } });
    return this.get(companyId, id);
  }

  /** DRAFT → DISPATCHED; locks quantities and the transport details. */
  async dispatch(companyId: string, id: string, userId: string) {
    const note = await this.getDraft(companyId, id);
    if (note.lines.every((l) => l.quantity.lte(0))) throw new BadRequestException("Nothing to dispatch — every quantity is zero");
    await this.prisma.deliveryNote.update({ where: { id }, data: { status: DeliveryNoteStatus.DISPATCHED } });
    await this.auditService.log({
      companyId,
      entityName: "DeliveryNote",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: note.status },
      afterSnapshot: { status: DeliveryNoteStatus.DISPATCHED },
    });
    return this.get(companyId, id);
  }

  /** DISPATCHED → DELIVERED once the customer's representative has signed for the goods. */
  async markDelivered(companyId: string, id: string, userId: string, dto: MarkDeliveredDto) {
    const note = await this.getOwned(companyId, id);
    if (note.status !== DeliveryNoteStatus.DISPATCHED) throw new ConflictException("Only a dispatched delivery note can be marked delivered");
    if (!dto.receivedByName.trim()) throw new BadRequestException("Enter the name of the person who received the goods");
    await this.prisma.deliveryNote.update({
      where: { id },
      data: { status: DeliveryNoteStatus.DELIVERED, receivedByName: dto.receivedByName.trim(), deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date() },
    });
    await this.auditService.log({
      companyId,
      entityName: "DeliveryNote",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: note.status },
      afterSnapshot: { status: DeliveryNoteStatus.DELIVERED, receivedByName: dto.receivedByName.trim() },
    });
    return this.get(companyId, id);
  }

  /** Frees the quantities for another delivery note. A delivered note is a signed record and cannot be cancelled. */
  async cancel(companyId: string, id: string, userId: string) {
    const note = await this.getOwned(companyId, id);
    if (note.status !== DeliveryNoteStatus.DRAFT && note.status !== DeliveryNoteStatus.DISPATCHED) {
      throw new ConflictException(`A ${note.status.toLowerCase()} delivery note cannot be cancelled`);
    }
    await this.prisma.deliveryNote.update({ where: { id }, data: { status: DeliveryNoteStatus.CANCELLED } });
    await this.auditService.log({
      companyId,
      entityName: "DeliveryNote",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: note.status },
      afterSnapshot: { status: DeliveryNoteStatus.CANCELLED },
    });
    return this.get(companyId, id);
  }

  /** Quantity already on live delivery notes, per sales order line (optionally leaving one note out). */
  private async deliveredByLine(companyId: string, salesOrderLineIds: string[], exceptNoteId?: string) {
    const rows = await this.prisma.deliveryNoteLine.groupBy({
      by: ["salesOrderLineId"],
      where: {
        salesOrderLineId: { in: salesOrderLineIds },
        deliveryNote: { companyId, status: { not: DeliveryNoteStatus.CANCELLED }, ...(exceptNoteId ? { id: { not: exceptNoteId } } : {}) },
      },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.salesOrderLineId, r._sum.quantity ?? new Prisma.Decimal(0)]));
  }

  private async getOwned(companyId: string, id: string) {
    const note = await this.prisma.deliveryNote.findFirst({
      where: { id, companyId },
      include: {
        lines: { include: { salesOrderLine: { include: { item: { select: { code: true } } } } }, orderBy: { salesOrderLine: { lineNumber: "asc" } } },
        salesOrder: { select: { orderNumber: true, businessPartner: { select: { code: true, name: true, taxRegistrationNumber: true } } } },
      },
    });
    if (!note) throw new NotFoundException("Delivery note not found");
    return note;
  }

  private async getDraft(companyId: string, id: string) {
    const note = await this.getOwned(companyId, id);
    if (note.status !== DeliveryNoteStatus.DRAFT) throw new ConflictException(`Delivery note is ${note.status} — only drafts can be modified`);
    return note;
  }
}
