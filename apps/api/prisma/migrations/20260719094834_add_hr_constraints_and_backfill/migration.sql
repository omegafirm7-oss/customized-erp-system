-- HR-phase DB constraints + backfill for pre-existing companies.
-- Applied via the create-only + paste pattern; idempotent where it touches
-- data. Runs AFTER add_hr_models so the new enum values are committed.

-- ── Constraints ──────────────────────────────────────────────────────────

-- One POSTED payroll run per company per fiscal period; corrections go
-- through reverse-then-rerun, preserving the full audit trail.
CREATE UNIQUE INDEX "payroll_one_posted_per_period"
  ON "payroll_runs" ("companyId", "fiscalPeriodId")
  WHERE "status" = 'POSTED';

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_salary_non_negative_check"
  CHECK ("basicSalary" >= 0 AND "housingAllowance" >= 0
         AND "transportAllowance" >= 0 AND "otherAllowance" >= 0
         AND "annualLeaveDays" >= 0);

ALTER TABLE "employee_loans"
  ADD CONSTRAINT "employee_loans_amounts_check"
  CHECK ("principal" > 0 AND "monthlyInstallment" > 0
         AND "monthlyInstallment" <= "principal"
         AND "balance" >= 0 AND "balance" <= "principal");

ALTER TABLE "payroll_run_lines"
  ADD CONSTRAINT "payroll_lines_inputs_non_negative_check"
  CHECK ("unpaidDays" >= 0 AND "absentDays" >= 0 AND "overtimeHours" >= 0
         AND "annualLeaveDaysTaken" >= 0 AND "otherDeduction" >= 0
         AND "loanDeduction" >= 0 AND "gosiEmployee" >= 0 AND "gosiEmployer" >= 0);

ALTER TABLE "hr_settings"
  ADD CONSTRAINT "hr_settings_rates_check"
  CHECK ("saudiEmployeeRatePct" >= 0 AND "saudiEmployerRatePct" >= 0
         AND "expatEmployerRatePct" >= 0 AND "gosiWageFloor" >= 0
         AND "gosiWageCap" >= "gosiWageFloor" AND "overtimeMultiplier" >= 0
         AND "hoursPerDay" > 0 AND "daysPerMonth" > 0);

ALTER TABLE "final_settlements"
  ADD CONSTRAINT "final_settlements_non_negative_check"
  CHECK ("finalSalaryAmount" >= 0 AND "eosbAmount" >= 0
         AND "leavePayoutAmount" >= 0 AND "loanRecovery" >= 0);

-- ── Backfill: HR accounts for existing companies ─────────────────────────

-- 1160 Employee Loans & Advances — CURRENT_ASSET under 1000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '1160', 'Employee Loans & Advances',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'ASSET'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_ASSET'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1000'),
  true, 'DEBIT', 'EMPLOYEE_LOANS', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1160'
);

-- 2310 Accrued Salaries Payable — CURRENT_LIABILITY under 2000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '2310', 'Accrued Salaries Payable',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'LIABILITY'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_LIABILITY'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2000'),
  true, 'CREDIT', 'SALARIES_PAYABLE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2310'
);

-- 2320 GOSI Payable — CURRENT_LIABILITY under 2000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '2320', 'GOSI Payable',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'LIABILITY'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_LIABILITY'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2000'),
  true, 'CREDIT', 'GOSI_PAYABLE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2320'
);

-- 2340 Leave Provision — CURRENT_LIABILITY under 2000
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '2340', 'Leave Provision',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'LIABILITY'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_LIABILITY'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2000'),
  true, 'CREDIT', 'LEAVE_PROVISION', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2340'
);

-- 2520 EOSB Provision — NON_CURRENT_LIABILITY under 2500
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '2520', 'End-of-Service Benefits Provision',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'LIABILITY'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'NON_CURRENT_LIABILITY'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2500'),
  true, 'CREDIT', 'EOSB_PROVISION', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '2520'
);

-- 5250 GOSI Expense — OPERATING_EXPENSE
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5250', 'GOSI Expense',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_EXPENSE'),
  NULL,
  true, 'DEBIT', 'GOSI_EXPENSE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5250'
);

-- 5260 EOSB Expense — OPERATING_EXPENSE
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5260', 'End-of-Service Benefits Expense',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_EXPENSE'),
  NULL,
  true, 'DEBIT', 'EOSB_EXPENSE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5260'
);

-- 5270 Leave Expense — OPERATING_EXPENSE
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5270', 'Leave Expense',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_EXPENSE'),
  NULL,
  true, 'DEBIT', 'LEAVE_EXPENSE', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5270'
);

-- 5200 Salaries & Wages exists since Phase 1 — tag it as the salary-expense
-- control account (idempotent; only where untagged).
UPDATE "accounts"
SET "controlAccountType" = 'SALARY_EXPENSE'
WHERE "code" = '5200' AND "controlAccountType" IS NULL;

-- ── Backfill: HR settings row with statutory defaults ────────────────────

INSERT INTO "hr_settings" ("id", "companyId", "updatedAt")
SELECT gen_random_uuid(), c."id", now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_settings" s WHERE s."companyId" = c."id"
);

-- ── Backfill: numbering series for the three HR document types ───────────
-- (OUTGOING_PAYMENT already owns "PAY-", so payroll runs use "PYR-".)

INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", d."documentType"::"DocumentType", d."prefix", 1, 6, NULL, true
FROM "companies" c
CROSS JOIN (VALUES
  ('PAYROLL_RUN', 'PYR-'),
  ('EMPLOYEE_LOAN', 'LOAN-'),
  ('FINAL_SETTLEMENT', 'FS-')
) AS d("documentType", "prefix")
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" n
  WHERE n."companyId" = c."id"
    AND n."documentType" = d."documentType"::"DocumentType"
    AND n."fiscalYearId" IS NULL
);
