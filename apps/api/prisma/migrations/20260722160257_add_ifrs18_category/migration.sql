-- CreateEnum
CREATE TYPE "Ifrs18Category" AS ENUM ('OPERATING', 'INVESTING', 'FINANCING', 'INCOME_TAX');

-- AlterTable
ALTER TABLE "account_sub_classes" ADD COLUMN     "ifrs18Category" "Ifrs18Category";

-- Backfill IFRS 18 category on the sub-classes that already exist. The new
-- INVESTING_INCOME sub-class (and reassignment of existing companies'
-- account 4950 into it) is handled by prisma/seed.ts instead, since that
-- row doesn't exist yet at migration time — seed.ts is idempotent and runs
-- after migrations in the normal deploy order.
UPDATE "account_sub_classes" SET "ifrs18Category" = 'OPERATING' WHERE "code" IN ('OPERATING_REVENUE', 'OTHER_INCOME', 'COST_OF_SALES', 'OPERATING_EXPENSE');
UPDATE "account_sub_classes" SET "ifrs18Category" = 'FINANCING' WHERE "code" = 'FINANCE_COST';
UPDATE "account_sub_classes" SET "ifrs18Category" = 'INCOME_TAX' WHERE "code" = 'TAX_EXPENSE';

