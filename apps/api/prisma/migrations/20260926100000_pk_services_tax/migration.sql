-- AlterEnum
ALTER TYPE "VatCategory" ADD VALUE 'PK_SERVICES';

-- AlterTable
ALTER TABLE "fbr_settings" ADD COLUMN     "servicesTaxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "defaultSalesPrice" DECIMAL(18,4);
