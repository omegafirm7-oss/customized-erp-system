-- Manpower-phase DB constraints + backfill for pre-existing companies.
-- Applied via the create-only + paste pattern; idempotent where it touches
-- data. Runs AFTER add_manpower_models so the new enum values are committed.

-- ── Constraints ──────────────────────────────────────────────────────────

ALTER TABLE "manpower_assignments"
  ADD CONSTRAINT "manpower_assignments_rates_check"
  CHECK ("billRate" >= 0 AND "otBillRate" >= 0);

ALTER TABLE "manpower_assignments"
  ADD CONSTRAINT "manpower_assignments_dates_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE "timesheet_entries"
  ADD CONSTRAINT "timesheet_entries_hours_check"
  CHECK ("hours" >= 0 AND "hours" <= 24 AND "overtimeHours" >= 0 AND "overtimeHours" <= 24);

-- ── Backfill: 4400 Manpower Rental Revenue for existing companies ────────

INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '4400', 'Manpower Rental Revenue',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'REVENUE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_REVENUE'),
  NULL,
  true, 'CREDIT', 'MANPOWER_REVENUE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '4400'
);
