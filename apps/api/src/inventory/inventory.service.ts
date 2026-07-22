import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ControlAccountType, DocumentType, Prisma, StockMovementType } from "@prisma/client";
import { AccountResolutionService } from "../finance/account-resolution.service";

type TxClient = Prisma.TransactionClient;

export interface StockOpBase {
  companyId: string;
  itemId: string;
  warehouseId: string;
  quantity: Prisma.Decimal;
  movementType: StockMovementType;
  sourceDocumentType: DocumentType;
  sourceDocumentId: string;
  postingDate: Date;
  userId: string;
  memo?: string | null;
}

export interface ReceiveStockInput extends StockOpBase {
  /** Functional-currency total cost of the receipt — the JE-authoritative
   * rounded amount, so subledger and GL always agree. */
  totalCost: Prisma.Decimal;
}

export interface IssueStockInput extends StockOpBase {
  /** Used by cancellation paths to un-do the exact value contribution of the
   * original movement rather than re-costing at the current average. */
  forcedTotalCost?: Prisma.Decimal;
}

export interface StockOpResult {
  movementId: string;
  unitCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  qtyAfter: Prisma.Decimal;
  avgCostAfter: Prisma.Decimal;
}

interface LockedStockRow {
  id: string;
  onHandQty: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

/**
 * The perpetual-inventory engine: moving weighted average per item per
 * warehouse (IAS 2). Both operations are transaction-aware — they MUST be
 * called with the caller's TransactionClient and never open their own
 * transaction, so a stock movement, its journal entry, and the business
 * document commit or roll back as one unit.
 *
 * Concurrency: the ItemWarehouseStock row is locked with SELECT ... FOR
 * UPDATE (upserted first so the row always exists). Callers operating on
 * multiple lines must process them in sorted (itemId, warehouseId) order to
 * preclude deadlocks between concurrent multi-line documents.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly accountResolution: AccountResolutionService) {}

  async receiveStock(tx: TxClient, input: ReceiveStockInput): Promise<StockOpResult> {
    if (input.quantity.lte(0)) {
      throw new ConflictException("Receipt quantity must be positive");
    }
    if (input.totalCost.lt(0)) {
      throw new ConflictException("Receipt cost cannot be negative");
    }

    const row = await this.lockStockRow(tx, input.companyId, input.itemId, input.warehouseId);

    const newQty = row.onHandQty.add(input.quantity);
    const newValue = row.totalValue.add(input.totalCost).toDecimalPlaces(4);
    const newAvg = newQty.gt(0) ? newValue.div(newQty).toDecimalPlaces(6) : new Prisma.Decimal(0);
    const unitCost = input.quantity.gt(0)
      ? input.totalCost.div(input.quantity).toDecimalPlaces(6)
      : new Prisma.Decimal(0);

    await tx.itemWarehouseStock.update({
      where: { id: row.id },
      data: { onHandQty: newQty, totalValue: newValue, avgCost: newAvg },
    });

    const movement = await tx.stockMovement.create({
      data: {
        companyId: input.companyId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        movementType: input.movementType,
        quantity: input.quantity,
        unitCost,
        totalCost: input.totalCost,
        qtyAfter: newQty,
        avgCostAfter: newAvg,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        postingDate: input.postingDate,
        memo: input.memo ?? null,
        createdByUserId: input.userId,
      },
    });

    return { movementId: movement.id, unitCost, totalCost: input.totalCost, qtyAfter: newQty, avgCostAfter: newAvg };
  }

  async issueStock(tx: TxClient, input: IssueStockInput): Promise<StockOpResult> {
    if (input.quantity.lte(0)) {
      throw new ConflictException("Issue quantity must be positive");
    }

    const row = await this.lockStockRow(tx, input.companyId, input.itemId, input.warehouseId);

    if (input.quantity.gt(row.onHandQty)) {
      const { itemCode, warehouseCode } = await this.getCodes(tx, input.itemId, input.warehouseId);
      throw new ConflictException(
        `Insufficient stock for item ${itemCode} in warehouse ${warehouseCode}: requested ${input.quantity}, available ${row.onHandQty}`,
      );
    }

    // Full-drain rule: issuing the entire on-hand quantity takes the entire
    // remaining value, eliminating residual rounding sediment so a fully
    // issued item carries exactly zero value.
    let totalCost: Prisma.Decimal;
    if (input.forcedTotalCost !== undefined) {
      totalCost = input.forcedTotalCost;
    } else if (input.quantity.eq(row.onHandQty)) {
      totalCost = row.totalValue;
    } else {
      totalCost = row.avgCost.mul(input.quantity).toDecimalPlaces(4);
    }

    const newQty = row.onHandQty.sub(input.quantity);
    const newValue = row.totalValue.sub(totalCost).toDecimalPlaces(4);
    if (newValue.lt(0)) {
      const { itemCode, warehouseCode } = await this.getCodes(tx, input.itemId, input.warehouseId);
      throw new ConflictException(
        `Issuing this quantity of ${itemCode} from ${warehouseCode} would drive stock value negative — post a stock adjustment first`,
      );
    }
    const newAvg = newQty.gt(0) ? newValue.div(newQty).toDecimalPlaces(6) : row.avgCost;
    const unitCost = totalCost.div(input.quantity).toDecimalPlaces(6);

    await tx.itemWarehouseStock.update({
      where: { id: row.id },
      data: { onHandQty: newQty, totalValue: newValue, avgCost: newAvg },
    });

    const movement = await tx.stockMovement.create({
      data: {
        companyId: input.companyId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        movementType: input.movementType,
        quantity: input.quantity,
        unitCost,
        totalCost,
        qtyAfter: newQty,
        avgCostAfter: newAvg,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        postingDate: input.postingDate,
        memo: input.memo ?? null,
        createdByUserId: input.userId,
      },
    });

    return { movementId: movement.id, unitCost, totalCost, qtyAfter: newQty, avgCostAfter: newAvg };
  }

  /** Links movements of a document to its journal entry — set-once, same tx
   * (the DB trigger rejects any other movement mutation). */
  async linkMovementsToJournal(tx: TxClient, sourceDocumentType: DocumentType, sourceDocumentId: string, journalEntryId: string) {
    await tx.stockMovement.updateMany({
      where: { sourceDocumentType, sourceDocumentId, journalEntryId: null },
      data: { journalEntryId },
    });
  }

  /** Inventory GL account: item default → INVENTORY control account. */
  async resolveInventoryAccount(tx: TxClient, companyId: string, item: { defaultInventoryAccountId: string | null }) {
    if (item.defaultInventoryAccountId) {
      const account = await tx.account.findFirst({
        where: { id: item.defaultInventoryAccountId, companyId, isActive: true, isPostable: true },
      });
      if (account) return account;
    }
    return this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.INVENTORY);
  }

  /** Upsert-then-lock: the row always exists before FOR UPDATE, so first
   * receipt and concurrent access share one code path. */
  private async lockStockRow(tx: TxClient, companyId: string, itemId: string, warehouseId: string): Promise<LockedStockRow> {
    await tx.$executeRaw`
      INSERT INTO "item_warehouse_stock" ("id", "companyId", "itemId", "warehouseId", "onHandQty", "totalValue", "avgCost", "updatedAt")
      VALUES (gen_random_uuid(), ${companyId}, ${itemId}, ${warehouseId}, 0, 0, 0, now())
      ON CONFLICT ("itemId", "warehouseId") DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{ id: string; onHandQty: Prisma.Decimal; totalValue: Prisma.Decimal; avgCost: Prisma.Decimal }>>`
      SELECT "id", "onHandQty", "totalValue", "avgCost"
      FROM "item_warehouse_stock"
      WHERE "itemId" = ${itemId} AND "warehouseId" = ${warehouseId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Stock row could not be created");
    }
    return {
      id: row.id,
      onHandQty: new Prisma.Decimal(row.onHandQty),
      totalValue: new Prisma.Decimal(row.totalValue),
      avgCost: new Prisma.Decimal(row.avgCost),
    };
  }

  private async getCodes(tx: TxClient, itemId: string, warehouseId: string) {
    const [item, warehouse] = await Promise.all([
      tx.item.findUnique({ where: { id: itemId }, select: { code: true } }),
      tx.warehouse.findUnique({ where: { id: warehouseId }, select: { code: true } }),
    ]);
    return { itemCode: item?.code ?? itemId, warehouseCode: warehouse?.code ?? warehouseId };
  }
}
