import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  JournalSourceModule,
  Prisma,
  StockAdjustmentDirection,
  StockMovementType,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { InventoryService } from "./inventory.service";
import { CreateStockAdjustmentDto } from "./dto/create-stock-adjustment.dto";

/**
 * Immediate-post stock adjustments, one direction per document.
 * IN: receive at the client-supplied unit cost — JE Dr Inventory / Cr 5150.
 * OUT: issue at moving average — JE Dr 5150 / Cr Inventory.
 * No cancel: post an opposite adjustment.
 */
@Injectable()
export class StockAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly glPostingService: GlPostingService,
    private readonly inventoryService: InventoryService,
    private readonly accountResolution: AccountResolutionService,
    private readonly auditService: AuditService,
  ) {}

  async create(companyId: string, userId: string, dto: CreateStockAdjustmentDto) {
    const adjustment = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: dto.warehouseId, companyId, isActive: true } });
      if (!warehouse) {
        throw new NotFoundException("Warehouse not found in this company");
      }

      const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, isInventoryItem: true } });
      const itemById = new Map(items.map((i) => [i.id, i]));
      if (items.length !== itemIds.length) {
        throw new BadRequestException("All adjustment lines must reference inventory items of this company");
      }
      if (dto.direction === StockAdjustmentDirection.IN) {
        for (const [index, line] of dto.lines.entries()) {
          if (!line.unitCost || Number(line.unitCost) <= 0) {
            throw new BadRequestException(`Line ${index + 1}: unitCost is required and must be positive for IN adjustments`);
          }
        }
      }

      const adjustmentNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.STOCK_ADJUSTMENT,
        fiscalYearId: null,
      });

      const postingDate = new Date(dto.postingDate);
      const created = await tx.stockAdjustment.create({
        data: {
          companyId,
          adjustmentNumber,
          warehouseId: dto.warehouseId,
          direction: dto.direction,
          postingDate,
          reason: dto.reason,
          createdByUserId: userId,
        },
      });

      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const adjustmentAccount = await this.accountResolution.getControlAccount(
        tx, companyId, ControlAccountType.INVENTORY_ADJUSTMENT,
      );

      // Per resolved inventory account, accumulate the functional value moved.
      const valueByInventoryAccount = new Map<string, Prisma.Decimal>();
      const zero = new Prisma.Decimal(0);

      const sortedLines = [...dto.lines].sort((a, b) => a.itemId.localeCompare(b.itemId));
      let lineNumber = 0;
      for (const line of sortedLines) {
        lineNumber += 1;
        const item = itemById.get(line.itemId)!;
        const quantity = new Prisma.Decimal(line.quantity);
        const inventoryAccount = await this.inventoryService.resolveInventoryAccount(tx, companyId, item);

        let unitCost: Prisma.Decimal;
        let totalCost: Prisma.Decimal;
        if (dto.direction === StockAdjustmentDirection.IN) {
          unitCost = new Prisma.Decimal(line.unitCost!);
          totalCost = unitCost.mul(quantity).toDecimalPlaces(4);
          await this.inventoryService.receiveStock(tx, {
            companyId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
            quantity,
            totalCost,
            movementType: StockMovementType.ADJUSTMENT_IN,
            sourceDocumentType: DocumentType.STOCK_ADJUSTMENT,
            sourceDocumentId: created.id,
            postingDate,
            userId,
            memo: dto.reason,
          });
        } else {
          const issued = await this.inventoryService.issueStock(tx, {
            companyId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
            quantity,
            movementType: StockMovementType.ADJUSTMENT_OUT,
            sourceDocumentType: DocumentType.STOCK_ADJUSTMENT,
            sourceDocumentId: created.id,
            postingDate,
            userId,
            memo: dto.reason,
          });
          unitCost = issued.unitCost;
          totalCost = issued.totalCost;
        }

        valueByInventoryAccount.set(
          inventoryAccount.id,
          (valueByInventoryAccount.get(inventoryAccount.id) ?? zero).add(totalCost),
        );

        await tx.stockAdjustmentLine.create({
          data: {
            stockAdjustmentId: created.id,
            companyId,
            lineNumber,
            itemId: line.itemId,
            quantity,
            unitCost,
            totalCost,
          },
        });
      }

      const totalValue = [...valueByInventoryAccount.values()].reduce((s, v) => s.add(v), zero);
      let journalEntryId: string | null = null;

      if (totalValue.gt(0)) {
        const glLines: PostedEntryLineInput[] = [];
        for (const [accountId, value] of valueByInventoryAccount) {
          if (value.eq(0)) continue;
          glLines.push({
            accountId,
            debit: dto.direction === StockAdjustmentDirection.IN ? value : zero,
            credit: dto.direction === StockAdjustmentDirection.OUT ? value : zero,
            amountInTransactionCurrency: value,
            description: `Stock adjustment ${adjustmentNumber}`,
          });
        }
        glLines.push({
          accountId: adjustmentAccount.id,
          debit: dto.direction === StockAdjustmentDirection.OUT ? totalValue : zero,
          credit: dto.direction === StockAdjustmentDirection.IN ? totalValue : zero,
          amountInTransactionCurrency: totalValue,
          description: dto.reason,
        });

        const journalEntry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate,
          documentDate: postingDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.INVENTORY,
          sourceDocumentId: created.id,
          memo: `Stock adjustment ${adjustmentNumber}: ${dto.reason}`,
          lines: glLines,
        });
        journalEntryId = journalEntry.id;

        await this.inventoryService.linkMovementsToJournal(tx, DocumentType.STOCK_ADJUSTMENT, created.id, journalEntry.id);
        await tx.stockAdjustment.update({ where: { id: created.id }, data: { journalEntryId } });
      }

      return tx.stockAdjustment.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: { include: { item: { select: { code: true, name: true } } } }, warehouse: true },
      });
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "StockAdjustment",
      entityId: adjustment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: adjustment,
    });

    return adjustment;
  }

  async list(companyId: string) {
    return this.prisma.stockAdjustment.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { lines: { include: { item: { select: { code: true, name: true } } } }, warehouse: true },
    });
  }

  async get(companyId: string, id: string) {
    const adjustment = await this.prisma.stockAdjustment.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: { select: { code: true, name: true } } } }, warehouse: true },
    });
    if (!adjustment) {
      throw new NotFoundException("Stock adjustment not found");
    }
    return adjustment;
  }
}
