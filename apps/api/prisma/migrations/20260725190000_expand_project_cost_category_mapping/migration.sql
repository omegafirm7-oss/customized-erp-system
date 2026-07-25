-- Expands the Project Intelligence category mapping backfilled in
-- 20260725173406_add_project_cost_category: reclassifies a few accounts
-- that were left "uncategorized" (Other) after real-world review, and adds
-- Salaries/GOSI/EOSB/Leave to Labor (previously only Employee Allowances
-- Expense counted toward Labor).
UPDATE "accounts" SET "costCategory" = 'MACHINERY'
  WHERE "code" = '5107';

UPDATE "accounts" SET "costCategory" = 'MATERIAL'
  WHERE "code" IN ('5108', '5110');

UPDATE "accounts" SET "costCategory" = 'LABOR'
  WHERE "code" IN ('5200', '5250', '5260', '5270');
