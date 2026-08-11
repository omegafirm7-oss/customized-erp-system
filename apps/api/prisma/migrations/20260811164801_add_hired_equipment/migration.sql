-- CreateEnum
CREATE TYPE "HiredEquipmentContractStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "HiredEquipmentDayType" AS ENUM ('WORKED', 'IDLE', 'BREAKDOWN', 'OFF');

-- AlterEnum
ALTER TYPE "ControlAccountType" ADD VALUE 'HIRED_EQUIPMENT_EXPENSE';

-- CreateTable
CREATE TABLE "hired_equipment_contracts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "HiredEquipmentContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hired_equipment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hired_equipment_assignments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentName" TEXT NOT NULL,
    "equipmentType" TEXT,
    "rateBasis" "RateBasis" NOT NULL,
    "billRate" DECIMAL(18,4) NOT NULL,
    "otBillRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hired_equipment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hired_equipment_timesheets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "purchaseInvoiceId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hired_equipment_timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hired_equipment_timesheet_entries" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dayType" "HiredEquipmentDayType" NOT NULL DEFAULT 'WORKED',
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(7,2) NOT NULL DEFAULT 0,

    CONSTRAINT "hired_equipment_timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hired_equipment_contracts_companyId_status_idx" ON "hired_equipment_contracts"("companyId", "status");

-- CreateIndex
CREATE INDEX "hired_equipment_contracts_projectId_idx" ON "hired_equipment_contracts"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "hired_equipment_contracts_companyId_code_key" ON "hired_equipment_contracts"("companyId", "code");

-- CreateIndex
CREATE INDEX "hired_equipment_assignments_contractId_idx" ON "hired_equipment_assignments"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "hired_equipment_timesheets_purchaseInvoiceId_key" ON "hired_equipment_timesheets"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "hired_equipment_timesheets_companyId_status_idx" ON "hired_equipment_timesheets"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hired_equipment_timesheets_contractId_fiscalPeriodId_key" ON "hired_equipment_timesheets"("contractId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "hired_equipment_timesheet_entries_companyId_date_idx" ON "hired_equipment_timesheet_entries"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "hired_equipment_timesheet_entries_timesheetId_assignmentId__key" ON "hired_equipment_timesheet_entries"("timesheetId", "assignmentId", "date");

-- AddForeignKey
ALTER TABLE "hired_equipment_contracts" ADD CONSTRAINT "hired_equipment_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_contracts" ADD CONSTRAINT "hired_equipment_contracts_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_contracts" ADD CONSTRAINT "hired_equipment_contracts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_assignments" ADD CONSTRAINT "hired_equipment_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "hired_equipment_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheets" ADD CONSTRAINT "hired_equipment_timesheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheets" ADD CONSTRAINT "hired_equipment_timesheets_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "hired_equipment_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheets" ADD CONSTRAINT "hired_equipment_timesheets_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheets" ADD CONSTRAINT "hired_equipment_timesheets_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheet_entries" ADD CONSTRAINT "hired_equipment_timesheet_entries_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "hired_equipment_timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hired_equipment_timesheet_entries" ADD CONSTRAINT "hired_equipment_timesheet_entries_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "hired_equipment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
