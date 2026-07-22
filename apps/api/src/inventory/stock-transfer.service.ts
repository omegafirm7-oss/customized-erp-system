import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, Prisma, StockMovementType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "./inventory.service";
import { CreateStockTransferDto } from "./dto/create-stock-transfer.dto";

/**
 * Immediate-post warehouse-to-warehouse transfers. No JE: with a single
 * INVENTORY control account the value never leaves the GL account — the
 * document plus its TRANSFER_OUT/TRANSFER_IN movement pair is the audit
 * trail. Corrections are made with an opposite transfer.
 */
@Injectable()
export class StockTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  async create(companyId: string, userId: string, dto: CreateStockTransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException("Source and destination warehouses must differ");
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const warehouses = await tx.warehouse.findMany({
        where: { id: { in: [dto.fromWarehouseId, dto.toWarehouseId] }, companyId, isActive: true },
      });
      if (warehouses.length !== 2) {
        throw new NotFoundException("Source or destination warehouse not found in this company");
      }

      const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, isInventoryItem: true } });
      if (items.length !== itemIds.length) {
        throw new BadRequestException("All transfer lines must reference inventory items of this company");
      }

      const transferNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.STOCK_TRANSFER,
        fiscalYearId: null,
      });

      const postingDate = new Date(dto.postingDate);
      const created = await tx.stockTransfer.create({
        data: {
          companyId,
          transferNumber,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          postingDate,
          memo: dto.memo,
          createdByUserId: userId,
        },
      });

      // Sorted line processing keeps the row-lock order deterministic.
      const sortedLines = [...dto.lines].sort((a, b) => a.itemId.localeCompare(b.itemId));
      let lineNumber = 0;
      for (const line of sortedLines) {
        lineNumber += 1;
        const quantity = new Prisma.Decimal(line.quantity);

        const issued = await this.inventoryService.issueStock(tx, {
          companyId,
          itemId: line.itemId,
          warehouseId: dto.fromWarehouseId,
          quantity,
          movementType: StockMovementType.TRANSFER_OUT,
          sourceDocumentType: DocumentType.STOCK_TRANSFER,
          sourceDocumentId: created.id,
          postingDate,
          userId,
          memo: `Transfer ${transferNumber}`,
        });

        await this.inventoryService.receiveStock(tx, {
          companyId,
          itemId: line.itemId,
          warehouseId: dto.toWarehouseId,
          quantity,
          totalCost: issued.totalCost,
          movementType: StockMovementType.TRANSFER_IN,
          sourceDocumentType: DocumentType.STOCK_TRANSFER,
          sourceDocumentId: created.id,
          postingDate,
          userId,
          memo: `Transfer ${transferNumber}`,
        });

        await tx.stockTransferLine.create({
          data: {
            stockTransferId: created.id,
            companyId,
            lineNumber,
            itemId: line.itemId,
            quantity,
            unitCost: issued.unitCost,
            totalCost: issued.totalCost,
          },
        });
      }

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: { include: { item: { select: { code: true, name: true } } } }, fromWarehouse: true, toWarehouse: true },
      });
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "StockTransfer",
      entityId: transfer.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: transfer,
    });

    return transfer;
  }

  async list(companyId: string) {
    return this.prisma.stockTransfer.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { lines: { include: { item: { select: { code: true, name: true } } } }, fromWarehouse: true, toWarehouse: true },
    });
  }

  async get(companyId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: { select: { code: true, name: true } } } }, fromWarehouse: true, toWarehouse: true },
    });
    if (!transfer) {
      throw new NotFoundException("Stock transfer not found");
    }
    return transfer;
  }
}
