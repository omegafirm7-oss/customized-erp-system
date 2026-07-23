import { BadRequestException, Injectable } from "@nestjs/common";
import { ControlAccountType, Prisma, ProjectStatus, RecognitionMethod, VatCategory } from "@prisma/client";
import { computeLineAmounts, sumDocumentTotals, DocumentTotals } from "./invoice-math";
import { AccountResolutionService } from "./account-resolution.service";
import { InvoiceLineDto } from "./dto/invoice-line.dto";

type TxClient = Prisma.TransactionClient;

export interface BuiltInvoiceLine {
  lineNumber: number;
  itemId: string | null;
  description: string;
  uomId: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatCategory: VatCategory;
  vatRate: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  accountId: string;
  warehouseId: string | null;
  projectId: string | null;
  wbsTaskId: string | null;
  costCenterId: string | null;
}

export interface BuiltInvoiceLines {
  lines: BuiltInvoiceLine[];
  totals: DocumentTotals;
}

/**
 * Turns invoice-line DTOs into fully resolved, computed line data shared by
 * AR and AP: item lookups, VAT category defaulting (explicit → item →
 * STANDARD_15), account resolution (explicit → item default per side →
 * error; PURCHASE-side inventory items resolve to the INVENTORY asset
 * account instead of an expense), warehouse resolution for inventory items
 * (explicit → company default → error), and amount computation.
 */
@Injectable()
export class LineBuilderService {
  constructor(private readonly accountResolution: AccountResolutionService) {}

  async buildLines(
    tx: TxClient,
    companyId: string,
    side: "SALES" | "PURCHASE",
    lineDtos: InvoiceLineDto[],
  ): Promise<BuiltInvoiceLines> {
    const itemIds = [...new Set(lineDtos.map((l) => l.itemId).filter((id): id is string => !!id))];
    const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId } });
    const itemById = new Map(items.map((item) => [item.id, item]));
    if (items.length !== itemIds.length) {
      throw new BadRequestException("One or more items are invalid for this company");
    }

    const explicitAccountIds = [...new Set(lineDtos.map((l) => l.accountId).filter((id): id is string => !!id))];
    if (explicitAccountIds.length > 0) {
      const accounts = await tx.account.findMany({ where: { id: { in: explicitAccountIds }, companyId } });
      if (accounts.length !== explicitAccountIds.length) {
        throw new BadRequestException("One or more line accounts are invalid for this company");
      }
    }

    const explicitWarehouseIds = [...new Set(lineDtos.map((l) => l.warehouseId).filter((id): id is string => !!id))];
    if (explicitWarehouseIds.length > 0) {
      const warehouses = await tx.warehouse.findMany({
        where: { id: { in: explicitWarehouseIds }, companyId, isActive: true },
      });
      if (warehouses.length !== explicitWarehouseIds.length) {
        throw new BadRequestException("One or more line warehouses are invalid for this company");
      }
    }

    const hasInventoryLines = lineDtos.some((dto) => dto.itemId && itemById.get(dto.itemId)?.isInventoryItem);
    const defaultWarehouse = hasInventoryLines
      ? await tx.warehouse.findFirst({ where: { companyId, isDefault: true, isActive: true } })
      : null;

    // Job-costing dimensions: batch-load referenced projects (with their
    // cost centers) and tasks; validate ownership and posting-status rules.
    const projectIds = [...new Set(lineDtos.map((l) => l.projectId).filter((id): id is string => !!id))];
    const projects = await tx.project.findMany({ where: { id: { in: projectIds }, companyId } });
    const projectById = new Map(projects.map((p) => [p.id, p]));
    if (projects.length !== projectIds.length) {
      throw new BadRequestException("One or more projects are invalid for this company");
    }
    for (const project of projects) {
      const allowed =
        side === "PURCHASE"
          ? project.status === ProjectStatus.ACTIVE
          : project.status === ProjectStatus.ACTIVE || project.status === ProjectStatus.COMPLETED;
      if (!allowed) {
        throw new BadRequestException(
          `Project ${project.code} is ${project.status} — ${side === "PURCHASE" ? "costs require an ACTIVE project" : "billing requires ACTIVE or COMPLETED"}`,
        );
      }
    }
    const taskIds = [...new Set(lineDtos.map((l) => l.wbsTaskId).filter((id): id is string => !!id))];
    const tasks = await tx.wbsTask.findMany({ where: { id: { in: taskIds }, companyId } });
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    if (tasks.length !== taskIds.length) {
      throw new BadRequestException("One or more WBS tasks are invalid for this company");
    }

    // Explicit cost-center dims (Phase 7 — e.g. manpower-contract billing).
    const explicitCcIds = [...new Set(lineDtos.map((l) => l.costCenterId).filter((id): id is string => !!id))];
    if (explicitCcIds.length > 0) {
      const ccs = await tx.costCenter.findMany({ where: { id: { in: explicitCcIds }, companyId, isActive: true } });
      if (ccs.length !== explicitCcIds.length) {
        throw new BadRequestException("One or more line cost centers are invalid or inactive for this company");
      }
    }

    // OVER_TIME billing posts to the Contract Liability account (progress
    // billings), never directly to revenue — the revrec run recognizes it.
    const hasOverTimeSalesLines =
      side === "SALES" &&
      lineDtos.some((dto) => dto.projectId && projectById.get(dto.projectId)?.recognitionMethod === RecognitionMethod.OVER_TIME);
    const contractLiabilityAccount = hasOverTimeSalesLines
      ? await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.CONTRACT_LIABILITY)
      : null;

    // Inventory account (purchase side) resolved once per company as fallback.
    let inventoryControlAccountId: string | null = null;
    if (side === "PURCHASE" && hasInventoryLines) {
      const control = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.INVENTORY);
      inventoryControlAccountId = control.id;
    }

    const lines: BuiltInvoiceLine[] = lineDtos.map((dto, index) => {
      const item = dto.itemId ? itemById.get(dto.itemId) : undefined;
      const isInventoryLine = !!item?.isInventoryItem;

      const vatCategory = dto.vatCategory ?? item?.vatCategory ?? VatCategory.STANDARD_15;

      if (dto.costCenterId && dto.projectId) {
        throw new BadRequestException(
          `Line ${index + 1}: costCenterId and projectId are mutually exclusive — a project line derives its cost center from the project`,
        );
      }
      const project = dto.projectId ? projectById.get(dto.projectId) : undefined;
      if (dto.wbsTaskId) {
        const task = taskById.get(dto.wbsTaskId);
        if (!task || !dto.projectId || task.projectId !== dto.projectId) {
          throw new BadRequestException(`Line ${index + 1}: WBS task does not belong to the line's project`);
        }
      }
      const isOverTimeSalesLine =
        side === "SALES" && project?.recognitionMethod === RecognitionMethod.OVER_TIME;

      let accountId: string | null;
      if (isOverTimeSalesLine) {
        // Progress billing — always Contract Liability; explicit overrides
        // are rejected to prevent accidental direct-revenue leakage.
        if (dto.accountId) {
          throw new BadRequestException(
            `Line ${index + 1}: OVER_TIME project billings post to the Contract Liability account — remove the account override`,
          );
        }
        accountId = contractLiabilityAccount!.id;
      } else if (side === "PURCHASE" && isInventoryLine) {
        // Inventory purchases capitalize into the asset account, not expense.
        accountId = dto.accountId ?? item?.defaultInventoryAccountId ?? inventoryControlAccountId;
      } else {
        accountId =
          dto.accountId ?? (side === "SALES" ? item?.defaultSalesAccountId : item?.defaultPurchaseAccountId) ?? null;
      }
      if (!accountId) {
        throw new BadRequestException(
          `Line ${index + 1}: no ${side === "SALES" ? "revenue" : "expense"} account — set one on the line or on the item`,
        );
      }

      let warehouseId: string | null = null;
      if (isInventoryLine) {
        warehouseId = dto.warehouseId ?? defaultWarehouse?.id ?? null;
        if (!warehouseId) {
          throw new BadRequestException(
            `Line ${index + 1}: item ${item!.code} is an inventory item — select a warehouse (no default warehouse configured)`,
          );
        }
      }

      const quantity = new Prisma.Decimal(dto.quantity);
      const unitPrice = new Prisma.Decimal(dto.unitPrice);
      const discountAmount = new Prisma.Decimal(dto.discountAmount ?? "0");
      const amounts = computeLineAmounts({ quantity, unitPrice, discountAmount, vatCategory, taxMode: dto.taxMode });

      return {
        lineNumber: index + 1,
        itemId: dto.itemId ?? null,
        description: dto.description,
        uomId: dto.uomId ?? item?.baseUoMId ?? null,
        quantity,
        unitPrice,
        discountAmount,
        netAmount: amounts.netAmount,
        vatCategory,
        vatRate: amounts.vatRate,
        vatAmount: amounts.vatAmount,
        grossAmount: amounts.grossAmount,
        accountId,
        warehouseId,
        projectId: dto.projectId ?? null,
        wbsTaskId: dto.wbsTaskId ?? null,
        costCenterId: dto.costCenterId ?? project?.costCenterId ?? null,
      };
    });

    return { lines, totals: sumDocumentTotals(lines) };
  }
}
