-- CreateEnum
CREATE TYPE "ManpowerContractStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "RateBasis" AS ENUM ('HOURLY', 'DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'APPROVED', 'INVOICED');

-- CreateEnum
CREATE TYPE "TimesheetDayType" AS ENUM ('WORKED', 'REST', 'ABSENT', 'UNPAID_LEAVE', 'ANNUAL_LEAVE');

-- AlterEnum
ALTER TYPE "ControlAccountType" ADD VALUE 'MANPOWER_REVENUE';

-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "costCenterId" TEXT;

-- CreateTable
CREATE TABLE "manpower_contracts" (
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

    CONSTRAINT "manpower_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manpower_assignments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "rateBasis" "RateBasis" NOT NULL,
    "billRate" DECIMAL(18,4) NOT NULL,
    "otBillRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manpower_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
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

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_entries" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dayType" "TimesheetDayType" NOT NULL DEFAULT 'WORKED',
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(7,2) NOT NULL DEFAULT 0,

    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manpower_contracts_costCenterId_key" ON "manpower_contracts"("costCenterId");

-- CreateIndex
CREATE INDEX "manpower_contracts_companyId_status_idx" ON "manpower_contracts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "manpower_contracts_companyId_code_key" ON "manpower_contracts"("companyId", "code");

-- CreateIndex
CREATE INDEX "manpower_assignments_contractId_idx" ON "manpower_assignments"("contractId");

-- CreateIndex
CREATE INDEX "manpower_assignments_employeeId_isActive_idx" ON "manpower_assignments"("employeeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_salesInvoiceId_key" ON "timesheets"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "timesheets_companyId_status_idx" ON "timesheets"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_contractId_fiscalPeriodId_key" ON "timesheets"("contractId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "timesheet_entries_employeeId_date_idx" ON "timesheet_entries"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_entries_timesheetId_assignmentId_date_key" ON "timesheet_entries"("timesheetId", "assignmentId", "date");

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manpower_contracts" ADD CONSTRAINT "manpower_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manpower_contracts" ADD CONSTRAINT "manpower_contracts_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manpower_contracts" ADD CONSTRAINT "manpower_contracts_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manpower_assignments" ADD CONSTRAINT "manpower_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "manpower_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manpower_assignments" ADD CONSTRAINT "manpower_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "manpower_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "manpower_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
