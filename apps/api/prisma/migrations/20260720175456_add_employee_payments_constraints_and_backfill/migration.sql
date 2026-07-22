-- Stage-1 employee-timesheet/payments-ledger constraints + backfill for
-- pre-existing companies. Applied via the create-only + paste pattern;
-- idempotent where it touches data. Runs AFTER add_employee_timesheet_and_
-- payments so the new enum values are committed.

-- ── Constraints ──────────────────────────────────────────────────────────

ALTER TABLE "employee_timesheet_entries"
  ADD CONSTRAINT "employee_timesheet_entries_hours_check"
  CHECK ("hoursWorked" >= 0 AND "hoursWorked" <= 24);

ALTER TABLE "employee_payments"
  ADD CONSTRAINT "employee_payments_amount_check"
  CHECK ("amount" > 0);

ALTER TABLE "employee_payments"
  ADD CONSTRAINT "employee_payments_recovered_amount_check"
  CHECK ("recoveredAmount" >= 0 AND "recoveredAmount" <= "amount");

ALTER TABLE "employee_payment_recoveries"
  ADD CONSTRAINT "employee_payment_recoveries_amount_check"
  CHECK ("amount" > 0);

-- ── Backfill: 5215 Employee Allowances Expense for existing companies ────

INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5215', 'Employee Allowances Expense',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_EXPENSE'),
  NULL,
  true, 'DEBIT', 'ALLOWANCE_EXPENSE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5215'
);

-- ── Backfill: EPY- numbering series ───────────────────────────────────────

INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", 'EMPLOYEE_PAYMENT'::"DocumentType", 'EPY-', 1, 6, NULL, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" n
  WHERE n."companyId" = c."id"
    AND n."documentType" = 'EMPLOYEE_PAYMENT'::"DocumentType"
    AND n."fiscalYearId" IS NULL
);
