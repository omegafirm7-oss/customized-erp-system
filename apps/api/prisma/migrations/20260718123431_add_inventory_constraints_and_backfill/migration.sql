-- Inventory-phase DB constraints + backfill for pre-existing companies.
-- Applied as a Prisma migration via the create-only + paste pattern
-- (same as gl-constraints.sql / finance-constraints.sql). Idempotent where
-- it touches data.

-- ── CHECK constraints ────────────────────────────────────────────────────

-- Perpetual-inventory state can never go negative (negative average cost
-- is meaningless under IAS 2 moving-average valuation).
ALTER TABLE "item_warehouse_stock"
  ADD CONSTRAINT "item_warehouse_stock_non_negative_check"
  CHECK ("onHandQty" >= 0 AND "totalValue" >= 0 AND "avgCost" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_positive_check"
  CHECK ("quantity" > 0 AND "totalCost" >= 0 AND "unitCost" >= 0);

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_distinct_warehouses_check"
  CHECK ("fromWarehouseId" <> "toWarehouseId");

ALTER TABLE "stock_adjustment_lines"
  ADD CONSTRAINT "stock_adjustment_lines_positive_check"
  CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "totalCost" >= 0);

-- At most one default warehouse per company.
CREATE UNIQUE INDEX "warehouses_one_default_per_company"
  ON "warehouses" ("companyId")
  WHERE "isDefault";

-- ── Movement-ledger immutability ─────────────────────────────────────────

-- stock_movements is an append-only subledger. The ONLY permitted update is
-- setting journalEntryId from NULL (the same-transaction linkage after the
-- JE is created); everything else is denied, including deletes.
CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Stock movements are append-only (movement %)', OLD."id";
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."companyId" <> OLD."companyId"
     OR NEW."itemId" <> OLD."itemId"
     OR NEW."warehouseId" <> OLD."warehouseId"
     OR NEW."movementType" <> OLD."movementType"
     OR NEW."quantity" <> OLD."quantity"
     OR NEW."unitCost" <> OLD."unitCost"
     OR NEW."totalCost" <> OLD."totalCost"
     OR NEW."qtyAfter" <> OLD."qtyAfter"
     OR NEW."avgCostAfter" <> OLD."avgCostAfter"
     OR NEW."sourceDocumentType" <> OLD."sourceDocumentType"
     OR NEW."sourceDocumentId" <> OLD."sourceDocumentId"
     OR NEW."postingDate" <> OLD."postingDate"
     OR NEW."createdByUserId" <> OLD."createdByUserId"
     OR (OLD."journalEntryId" IS NOT NULL AND NEW."journalEntryId" IS DISTINCT FROM OLD."journalEntryId") THEN
    RAISE EXCEPTION 'Stock movements are immutable; only journalEntryId may be set once (movement %)', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_stock_movement_mutation
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_stock_movement_mutation();

-- ── Backfill for companies created before this phase ─────────────────────

-- 1. Give every company without a default warehouse one: flag the first
--    existing warehouse, or create MAIN where none exists at all.
UPDATE "warehouses" w
SET "isDefault" = true
WHERE w."id" = (
  SELECT w2."id" FROM "warehouses" w2
  WHERE w2."companyId" = w."companyId" AND w2."isActive"
  ORDER BY w2."code" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "warehouses" d
  WHERE d."companyId" = w."companyId" AND d."isDefault"
);

INSERT INTO "warehouses" ("id", "companyId", "code", "name", "isDefault", "isActive")
SELECT gen_random_uuid(), c."id", 'MAIN', 'Main Warehouse', true, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "warehouses" w WHERE w."companyId" = c."id"
);

-- 2. Numbering series for the two new document types.
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", dt."documentType"::"DocumentType", dt."prefix", 1, 6, NULL, true
FROM "companies" c
CROSS JOIN (VALUES
  ('STOCK_TRANSFER', 'ST-'),
  ('STOCK_ADJUSTMENT', 'ADJ-')
) AS dt("documentType", "prefix")
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id"
    AND ns."documentType" = dt."documentType"::"DocumentType"
    AND ns."fiscalYearId" IS NULL
);

-- 3. Flag 5100 Cost of Goods Sold as the COGS control account.
UPDATE "accounts"
SET "controlAccountType" = 'COGS'
WHERE "code" = '5100' AND "controlAccountType" IS NULL;

-- 4. Insert 5150 "Inventory Adjustment Gain/Loss" per company where missing.
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5150', 'Inventory Adjustment Gain/Loss',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'COST_OF_SALES'),
  NULL,
  true, 'DEBIT', 'INVENTORY_ADJUSTMENT', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5150'
);
