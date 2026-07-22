-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecognitionMethod" AS ENUM ('POINT_IN_TIME', 'OVER_TIME');

-- CreateEnum
CREATE TYPE "RevenueRecognitionRunStatus" AS ENUM ('POSTED', 'REVERSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ControlAccountType" ADD VALUE 'CONTRACT_ASSET';
ALTER TYPE "ControlAccountType" ADD VALUE 'CONTRACT_LIABILITY';
ALTER TYPE "ControlAccountType" ADD VALUE 'CONTRACT_REVENUE';

-- AlterEnum
ALTER TYPE "JournalSourceModule" ADD VALUE 'PROJECTS';

-- AlterTable
ALTER TABLE "journal_entry_lines" ADD COLUMN     "wbsTaskId" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoice_lines" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "wbsTaskId" TEXT;

-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "wbsTaskId" TEXT;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessPartnerId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "recognitionMethod" "RecognitionMethod" NOT NULL DEFAULT 'POINT_IN_TIME',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "contractValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimatedTotalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costCenterId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentTaskId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costBudget" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wbs_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_recognition_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "costsToDateFunctional" DECIMAL(18,4) NOT NULL,
    "estimatedTotalCostSnapshot" DECIMAL(18,4) NOT NULL,
    "contractValueSnapshot" DECIMAL(18,4) NOT NULL,
    "percentComplete" DECIMAL(7,4) NOT NULL,
    "cumulativeRevenue" DECIMAL(18,4) NOT NULL,
    "previouslyRecognized" DECIMAL(18,4) NOT NULL,
    "recognizedThisRun" DECIMAL(18,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "status" "RevenueRecognitionRunStatus" NOT NULL DEFAULT 'POSTED',
    "reversalJournalEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_recognition_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_costCenterId_key" ON "projects"("costCenterId");

-- CreateIndex
CREATE INDEX "projects_companyId_status_idx" ON "projects"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_companyId_code_key" ON "projects"("companyId", "code");

-- CreateIndex
CREATE INDEX "wbs_tasks_projectId_idx" ON "wbs_tasks"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_tasks_projectId_code_key" ON "wbs_tasks"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_recognition_runs_journalEntryId_key" ON "revenue_recognition_runs"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_recognition_runs_reversalJournalEntryId_key" ON "revenue_recognition_runs"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "revenue_recognition_runs_projectId_fiscalPeriodId_idx" ON "revenue_recognition_runs"("projectId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "journal_entry_lines_costCenterId_idx" ON "journal_entry_lines"("costCenterId");

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_wbsTaskId_fkey" FOREIGN KEY ("wbsTaskId") REFERENCES "wbs_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_wbsTaskId_fkey" FOREIGN KEY ("wbsTaskId") REFERENCES "wbs_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_wbsTaskId_fkey" FOREIGN KEY ("wbsTaskId") REFERENCES "wbs_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_tasks" ADD CONSTRAINT "wbs_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_tasks" ADD CONSTRAINT "wbs_tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "wbs_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_runs" ADD CONSTRAINT "revenue_recognition_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_runs" ADD CONSTRAINT "revenue_recognition_runs_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_runs" ADD CONSTRAINT "revenue_recognition_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_runs" ADD CONSTRAINT "revenue_recognition_runs_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
