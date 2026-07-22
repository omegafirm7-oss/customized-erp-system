-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "UsageDayType" AS ENUM ('ON_RENT', 'IDLE', 'BREAKDOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ControlAccountType" ADD VALUE 'EQUIPMENT_REVENUE';
ALTER TYPE "ControlAccountType" ADD VALUE 'DISPOSAL_GAIN_LOSS';
ALTER TYPE "ControlAccountType" ADD VALUE 'EQUIPMENT_ASSET';
ALTER TYPE "ControlAccountType" ADD VALUE 'ACCUM_DEPRECIATION';
ALTER TYPE "ControlAccountType" ADD VALUE 'DEPRECIATION_EXPENSE';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DEPRECIATION_RUN';

-- AlterEnum
ALTER TYPE "JournalSourceModule" ADD VALUE 'EQUIPMENT';

-- AlterTable
ALTER TABLE "purchase_invoice_lines" ADD COLUMN     "costCenterId" TEXT;

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serialNumber" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(18,4) NOT NULL,
    "salvageValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "depreciationStartDate" TIMESTAMP(3) NOT NULL,
    "openingAccumulatedDepreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "capitalizationJournalEntryId" TEXT,
    "disposalDate" TIMESTAMP(3),
    "disposalProceeds" DECIMAL(18,4),
    "disposalJournalEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_rental_contracts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "status" "ManpowerContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "costCenterId" TEXT NOT NULL,
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_rental_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_assignments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "rateBasis" "RateBasis" NOT NULL,
    "billRate" DECIMAL(18,4) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "salesInvoiceId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_log_entries" (
    "id" TEXT NOT NULL,
    "usageLogId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dayStatus" "UsageDayType" NOT NULL DEFAULT 'ON_RENT',
    "hoursUsed" DECIMAL(7,2) NOT NULL DEFAULT 0,

    CONSTRAINT "usage_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'POSTED',
    "journalEntryId" TEXT NOT NULL,
    "reversalJournalEntryId" TEXT,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_run_lines" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "accumulatedAfter" DECIMAL(18,4) NOT NULL,
    "nbvAfter" DECIMAL(18,4) NOT NULL,
    "costCenterId" TEXT,

    CONSTRAINT "depreciation_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_capitalizationJournalEntryId_key" ON "equipment"("capitalizationJournalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_disposalJournalEntryId_key" ON "equipment"("disposalJournalEntryId");

-- CreateIndex
CREATE INDEX "equipment_companyId_status_idx" ON "equipment"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_companyId_code_key" ON "equipment"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_rental_contracts_costCenterId_key" ON "equipment_rental_contracts"("costCenterId");

-- CreateIndex
CREATE INDEX "equipment_rental_contracts_companyId_status_idx" ON "equipment_rental_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_rental_contracts_companyId_code_key" ON "equipment_rental_contracts"("companyId", "code");

-- CreateIndex
CREATE INDEX "equipment_assignments_contractId_idx" ON "equipment_assignments"("contractId");

-- CreateIndex
CREATE INDEX "equipment_assignments_equipmentId_isActive_idx" ON "equipment_assignments"("equipmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "usage_logs_salesInvoiceId_key" ON "usage_logs"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "usage_logs_companyId_status_idx" ON "usage_logs"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_logs_contractId_fiscalPeriodId_key" ON "usage_logs"("contractId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "usage_log_entries_equipmentId_date_idx" ON "usage_log_entries"("equipmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "usage_log_entries_usageLogId_assignmentId_date_key" ON "usage_log_entries"("usageLogId", "assignmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_journalEntryId_key" ON "depreciation_runs"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_reversalJournalEntryId_key" ON "depreciation_runs"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "depreciation_runs_companyId_fiscalPeriodId_idx" ON "depreciation_runs"("companyId", "fiscalPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_companyId_runNumber_key" ON "depreciation_runs"("companyId", "runNumber");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_run_lines_runId_equipmentId_key" ON "depreciation_run_lines"("runId", "equipmentId");

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_capitalizationJournalEntryId_fkey" FOREIGN KEY ("capitalizationJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_disposalJournalEntryId_fkey" FOREIGN KEY ("disposalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_rental_contracts" ADD CONSTRAINT "equipment_rental_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_rental_contracts" ADD CONSTRAINT "equipment_rental_contracts_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_rental_contracts" ADD CONSTRAINT "equipment_rental_contracts_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "equipment_rental_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "equipment_rental_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_log_entries" ADD CONSTRAINT "usage_log_entries_usageLogId_fkey" FOREIGN KEY ("usageLogId") REFERENCES "usage_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_log_entries" ADD CONSTRAINT "usage_log_entries_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "equipment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_log_entries" ADD CONSTRAINT "usage_log_entries_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "depreciation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_run_lines" ADD CONSTRAINT "depreciation_run_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
