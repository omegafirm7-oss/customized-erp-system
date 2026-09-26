-- CreateEnum
CREATE TYPE "FbrRegistrationType" AS ENUM ('REGISTERED', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "FbrEnvironment" AS ENUM ('MOCK', 'SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "FbrChannel" AS ENUM ('DI', 'POS');

-- CreateEnum
CREATE TYPE "FbrSubmissionStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VatCategory" ADD VALUE 'PK_STANDARD';
ALTER TYPE "VatCategory" ADD VALUE 'PK_REDUCED';
ALTER TYPE "VatCategory" ADD VALUE 'PK_THIRD_SCHEDULE';

-- AlterTable
ALTER TABLE "business_partners" ADD COLUMN     "fbrRegistrationCheckedAt" TIMESTAMP(3),
ADD COLUMN     "fbrRegistrationType" "FbrRegistrationType",
ADD COLUMN     "ntnCnic" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "strn" TEXT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "fbrBusinessActivity" TEXT,
ADD COLUMN     "fbrSector" TEXT,
ADD COLUMN     "ntn" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "strn" TEXT;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "fbrSaleType" TEXT,
ADD COLUMN     "fbrUom" TEXT,
ADD COLUMN     "hsCode" TEXT,
ADD COLUMN     "reducedRate" DECIMAL(5,2),
ADD COLUMN     "retailPrice" DECIMAL(18,4),
ADD COLUMN     "sroItemSerialNo" TEXT,
ADD COLUMN     "sroScheduleNo" TEXT;

-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "furtherTaxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "furtherTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retailValue" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "buyerNtnCnicSnapshot" TEXT,
ADD COLUMN     "buyerProvinceSnapshot" TEXT,
ADD COLUMN     "buyerRegTypeSnapshot" "FbrRegistrationType",
ADD COLUMN     "furtherTaxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fbr_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" "FbrEnvironment" NOT NULL DEFAULT 'MOCK',
    "diTokenEnc" TEXT,
    "posTokenEnc" TEXT,
    "furtherTaxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 4,
    "posFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "posFeeAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fbr_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fbr_submissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "FbrChannel" NOT NULL,
    "environment" "FbrEnvironment" NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "status" "FbrSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "fbrInvoiceNumber" TEXT,
    "requestJson" JSONB NOT NULL,
    "responseJson" JSONB,
    "errors" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fbr_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_terminals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fbrPosId" INTEGER NOT NULL,
    "warehouseId" TEXT,
    "costCenterId" TEXT,
    "walkInPartnerId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "cardAccountId" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "clientSaleId" TEXT NOT NULL,
    "invoiceType" INTEGER NOT NULL,
    "refPosSaleId" TEXT,
    "paymentMode" INTEGER NOT NULL,
    "posFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "salesInvoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fbr_settings_companyId_key" ON "fbr_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "fbr_submissions_salesInvoiceId_key" ON "fbr_submissions"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "fbr_submissions_companyId_status_idx" ON "fbr_submissions"("companyId", "status");

-- CreateIndex
CREATE INDEX "fbr_submissions_companyId_channel_idx" ON "fbr_submissions"("companyId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_apiKeyHash_key" ON "pos_terminals"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_companyId_code_key" ON "pos_terminals"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_salesInvoiceId_key" ON "pos_sales"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "pos_sales_companyId_createdAt_idx" ON "pos_sales"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_terminalId_clientSaleId_key" ON "pos_sales"("terminalId", "clientSaleId");

-- AddForeignKey
ALTER TABLE "fbr_settings" ADD CONSTRAINT "fbr_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fbr_submissions" ADD CONSTRAINT "fbr_submissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fbr_submissions" ADD CONSTRAINT "fbr_submissions_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed PKR (Pakistan) so PK companies can use it as base currency.
INSERT INTO "currencies" ("code", "name", "decimalPlaces") VALUES ('PKR', 'Pakistani Rupee', 2) ON CONFLICT ("code") DO NOTHING;
