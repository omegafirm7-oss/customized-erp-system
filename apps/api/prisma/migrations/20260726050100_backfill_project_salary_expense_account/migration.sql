-- 5112 Project Salaries & Wages — COST_OF_SALES under 5000, backfilled onto
-- every existing company's chart of accounts (idempotent).
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "costCategory", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5112', 'Project Salaries & Wages',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'COST_OF_SALES'),
  NULL,
  true, 'DEBIT', 'PROJECT_SALARY_EXPENSE', 'LABOR', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5112'
);
