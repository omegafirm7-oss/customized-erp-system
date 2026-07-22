-- Equipment-phase DB constraints + backfill for pre-existing companies.
-- Applied via the create-only + paste pattern; idempotent where it touches
-- data. Runs AFTER add_equipment_models so the new enum values are committed.

-- ── Constraints ──────────────────────────────────────────────────────────

-- One POSTED depreciation run per company per fiscal period.
CREATE UNIQUE INDEX "depr_one_posted_per_period"
  ON "depreciation_runs" ("companyId", "fiscalPeriodId")
  WHERE "status" = 'POSTED';

ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_amounts_check"
  CHECK ("acquisitionCost" >= 0 AND "salvageValue" >= 0
         AND "salvageValue" <= "acquisitionCost"
         AND "usefulLifeMonths" > 0
         AND "openingAccumulatedDepreciation" >= 0
         AND "openingAccumulatedDepreciation" <= "acquisitionCost" - "salvageValue");

ALTER TABLE "equipment_assignments"
  ADD CONSTRAINT "equipment_assignments_rate_check"
  CHECK ("billRate" >= 0);

ALTER TABLE "equipment_assignments"
  ADD CONSTRAINT "equipment_assignments_dates_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE "usage_log_entries"
  ADD CONSTRAINT "usage_log_entries_hours_check"
  CHECK ("hoursUsed" >= 0 AND "hoursUsed" <= 24);

ALTER TABLE "depreciation_run_lines"
  ADD CONSTRAINT "depr_lines_amounts_check"
  CHECK ("amount" >= 0 AND "accumulatedAfter" >= 0 AND "nbvAfter" >= 0);

-- ── Backfill: equipment accounts for existing companies ──────────────────

-- 4500 Equipment Rental Revenue — OPERATING_REVENUE
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '4500', 'Equipment Rental Revenue',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'REVENUE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_REVENUE'),
  NULL,
  true, 'CREDIT', 'EQUIPMENT_REVENUE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4500'
);

-- 4950 Gain/Loss on Asset Disposal — OTHER_INCOME
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '4950', 'Gain/Loss on Asset Disposal',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'REVENUE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OTHER_INCOME'),
  NULL,
  true, 'CREDIT', 'DISPOSAL_GAIN_LOSS', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4950'
);

-- Existing Phase-1 accounts become the equipment control accounts
UPDATE "accounts" SET "controlAccountType" = 'EQUIPMENT_ASSET'
WHERE "code" = '1512' AND "controlAccountType" IS NULL;

UPDATE "accounts" SET "controlAccountType" = 'ACCUM_DEPRECIATION'
WHERE "code" = '1519' AND "controlAccountType" IS NULL;

UPDATE "accounts" SET "controlAccountType" = 'DEPRECIATION_EXPENSE'
WHERE "code" = '5230' AND "controlAccountType" IS NULL;

-- ── Backfill: DEPR- numbering series ─────────────────────────────────────

INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", 'DEPRECIATION_RUN'::"DocumentType", 'DEPR-', 1, 6, NULL, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" n
  WHERE n."companyId" = c."id"
    AND n."documentType" = 'DEPRECIATION_RUN'::"DocumentType"
    AND n."fiscalYearId" IS NULL
);
