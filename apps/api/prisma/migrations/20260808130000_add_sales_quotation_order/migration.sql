-- CreateEnum
CREATE TYPE "SalesQuotationStatus" AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_INVOICED', 'INVOICED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'SALES_QUOTATION';
ALTER TYPE "DocumentType" ADD VALUE 'SALES_ORDER';

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "sourceSalesOrderId" TEXT;

-- CreateTable
CREATE TABLE "sales_quotations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationNumber" TEXT,
    "businessPartnerId" TEXT NOT NULL,
    "quotationDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" "SalesQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotation_lines" (
    "id" TEXT NOT NULL,
    "salesQuotationId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "vatCategory" "VatCategory",

    CONSTRAINT "sales_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "businessPartnerId" TEXT NOT NULL,
    "sourceQuotationId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "invoicedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "vatCategory" "VatCategory",
    "warehouseId" TEXT,
    "costCenterId" TEXT,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_quotations_companyId_status_idx" ON "sales_quotations"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotations_companyId_quotationNumber_key" ON "sales_quotations"("companyId", "quotationNumber");

-- CreateIndex
CREATE INDEX "sales_quotation_lines_salesQuotationId_idx" ON "sales_quotation_lines"("salesQuotationId");

-- CreateIndex
CREATE INDEX "sales_orders_companyId_status_idx" ON "sales_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_orders_sourceQuotationId_idx" ON "sales_orders"("sourceQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_companyId_orderNumber_key" ON "sales_orders"("companyId", "orderNumber");

-- CreateIndex
CREATE INDEX "sales_order_lines_salesOrderId_idx" ON "sales_order_lines"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_invoices_sourceSalesOrderId_idx" ON "sales_invoices"("sourceSalesOrderId");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sourceSalesOrderId_fkey" FOREIGN KEY ("sourceSalesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_salesQuotationId_fkey" FOREIGN KEY ("salesQuotationId") REFERENCES "sales_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sourceQuotationId_fkey" FOREIGN KEY ("sourceQuotationId") REFERENCES "sales_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill numbering series for the two new document types on every
-- existing company, mirroring the pattern used when Purchase's PQ-/PO-
-- series were first introduced. New companies get these from
-- CompaniesService.createCompany's seriesDefs list going forward.
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "fiscalYearId", "prefix", "nextNumber", "numberLength")
SELECT gen_random_uuid(), c."id", 'SALES_QUOTATION', NULL, 'SQ-', 1, 6
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = 'SALES_QUOTATION' AND ns."fiscalYearId" IS NULL
);

INSERT INTO "numbering_series" ("id", "companyId", "documentType", "fiscalYearId", "prefix", "nextNumber", "numberLength")
SELECT gen_random_uuid(), c."id", 'SALES_ORDER', NULL, 'SO-', 1, 6
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = 'SALES_ORDER' AND ns."fiscalYearId" IS NULL
);
