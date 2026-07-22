-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesDocumentKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ControlAccountType" ADD VALUE 'VAT_OUTPUT';
ALTER TYPE "ControlAccountType" ADD VALUE 'VAT_INPUT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'INCOMING_PAYMENT';
ALTER TYPE "DocumentType" ADD VALUE 'OUTGOING_PAYMENT';

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "documentKind" "SalesDocumentKind" NOT NULL DEFAULT 'INVOICE',
    "businessPartnerId" TEXT NOT NULL,
    "originalInvoiceId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDateTime" TIMESTAMP(3) NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRateToFunctional" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "buyerNameSnapshot" TEXT,
    "buyerTrnSnapshot" TEXT,
    "invoiceTypeCode" TEXT,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "uomId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "vatCategory" "VatCategory" NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "vatAmount" DECIMAL(18,4) NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "revenueAccountId" TEXT NOT NULL,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "vendorInvoiceNumber" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRateToFunctional" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossTotalFunctional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "uomId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "vatCategory" "VatCategory" NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "vatAmount" DECIMAL(18,4) NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "expenseAccountId" TEXT NOT NULL,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentNumber" TEXT,
    "direction" "PaymentDirection" NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "bankCashAccountId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRateToFunctional" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "memo" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "journalEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_journalEntryId_key" ON "sales_invoices"("journalEntryId");

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_status_idx" ON "sales_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_businessPartnerId_idx" ON "sales_invoices"("companyId", "businessPartnerId");

-- CreateIndex
CREATE INDEX "sales_invoices_companyId_dueDate_idx" ON "sales_invoices"("companyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_companyId_invoiceNumber_key" ON "sales_invoices"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_salesInvoiceId_idx" ON "sales_invoice_lines"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_companyId_itemId_idx" ON "sales_invoice_lines"("companyId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_journalEntryId_key" ON "purchase_invoices"("journalEntryId");

-- CreateIndex
CREATE INDEX "purchase_invoices_companyId_status_idx" ON "purchase_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "purchase_invoices_companyId_dueDate_idx" ON "purchase_invoices"("companyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_companyId_invoiceNumber_key" ON "purchase_invoices"("companyId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_companyId_businessPartnerId_vendorInvoice_key" ON "purchase_invoices"("companyId", "businessPartnerId", "vendorInvoiceNumber");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_purchaseInvoiceId_idx" ON "purchase_invoice_lines"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_companyId_itemId_idx" ON "purchase_invoice_lines"("companyId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_journalEntryId_key" ON "payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "payments_companyId_direction_status_idx" ON "payments"("companyId", "direction", "status");

-- CreateIndex
CREATE INDEX "payments_companyId_businessPartnerId_idx" ON "payments"("companyId", "businessPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_companyId_paymentNumber_key" ON "payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_salesInvoiceId_idx" ON "payment_allocations"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_purchaseInvoiceId_idx" ON "payment_allocations"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankCashAccountId_fkey" FOREIGN KEY ("bankCashAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
