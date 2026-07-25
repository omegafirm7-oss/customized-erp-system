-- CreateEnum
CREATE TYPE "ProjectCostCategory" AS ENUM ('MATERIAL', 'MACHINERY', 'LABOR');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "costCategory" "ProjectCostCategory";

-- AlterTable
ALTER TABLE "employee_payments" ADD COLUMN     "expenseAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: assign Project Intelligence categories to the known default-COA
-- accounts on every existing company, by code (account codes are immutable
-- once created — the COA rename endpoint only ever changes name/nameAr).
UPDATE "accounts" SET "costCategory" = 'MATERIAL'
  WHERE "code" IN ('5101', '5104', '5105', '5106', '5109');

UPDATE "accounts" SET "costCategory" = 'MACHINERY'
  WHERE "code" IN ('5102', '5103');

UPDATE "accounts" SET "costCategory" = 'LABOR'
  WHERE "code" = '5215';
