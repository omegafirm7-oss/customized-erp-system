-- Projects-phase DB constraints + backfill for pre-existing companies.
-- Applied via the create-only + paste pattern; idempotent where it touches
-- data. Runs AFTER add_projects_models so the new enum values are committed.

-- ── Constraints ──────────────────────────────────────────────────────────

-- One POSTED revenue-recognition run per project per period; corrections go
-- through reverse-then-rerun, preserving the full audit trail.
CREATE UNIQUE INDEX "revrec_one_posted_per_project_period"
  ON "revenue_recognition_runs" ("projectId", "fiscalPeriodId")
  WHERE "status" = 'POSTED';

ALTER TABLE "revenue_recognition_runs"
  ADD CONSTRAINT "revrec_percent_complete_range_check"
  CHECK ("percentComplete" >= 0 AND "percentComplete" <= 1);

ALTER TABLE "revenue_recognition_runs"
  ADD CONSTRAINT "revrec_non_negative_check"
  CHECK ("costsToDateFunctional" >= 0 AND "cumulativeRevenue" >= 0
         AND "estimatedTotalCostSnapshot" >= 0 AND "contractValueSnapshot" >= 0);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_non_negative_check"
  CHECK ("contractValue" >= 0 AND "estimatedTotalCost" >= 0);

ALTER TABLE "wbs_tasks"
  ADD CONSTRAINT "wbs_tasks_budget_non_negative_check"
  CHECK ("costBudget" >= 0);

-- ── Backfill: contract accounting accounts for existing companies ────────

-- 1450 Contract Asset (WIP) — CURRENT_ASSET under 1000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '1450', 'Contract Asset (WIP)',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'ASSET'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_ASSET'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1000'),
  true, 'DEBIT', 'CONTRACT_ASSET', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1450'
);

-- 2400 Contract Liability (Progress Billings) — CURRENT_LIABILITY under 2000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '2400', 'Contract Liability (Progress Billings)',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'LIABILITY'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_LIABILITY'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2000'),
  true, 'CREDIT', 'CONTRACT_LIABILITY', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2400'
);

-- 4300 Contract Revenue (POC) — OPERATING_REVENUE
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '4300', 'Contract Revenue (POC)',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'REVENUE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_REVENUE'),
  NULL,
  true, 'CREDIT', 'CONTRACT_REVENUE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4300'
);
