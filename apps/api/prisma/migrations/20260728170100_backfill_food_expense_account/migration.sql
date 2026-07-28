-- 5216 Employee Food Expense — split out of Employee Allowances Expense (5215)
-- so FOOD-category employee payments no longer share an account with
-- ALLOWANCE-category payments, backfilled onto every existing company's
-- chart of accounts (idempotent).
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "costCategory", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5216', 'Employee Food Expense',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'OPERATING_EXPENSE'),
  NULL,
  true, 'DEBIT', 'FOOD_EXPENSE', 'LABOR', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5216'
);
