-- CreateEnum
CREATE TYPE "EmployeePaymentCategory" AS ENUM ('ALLOWANCE', 'ADVANCE', 'OTHER');

-- AlterEnum
ALTER TYPE "ControlAccountType" ADD VALUE 'ALLOWANCE_EXPENSE';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'EMPLOYEE_PAYMENT';

-- DropForeignKey
ALTER TABLE "employee_attendance" DROP CONSTRAINT "employee_attendance_companyId_fkey";

-- DropForeignKey
ALTER TABLE "employee_attendance" DROP CONSTRAINT "employee_attendance_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "employee_attendance" DROP CONSTRAINT "employee_attendance_fiscalPeriodId_fkey";

-- DropTable
DROP TABLE "employee_attendance";

-- CreateTable
CREATE TABLE "employee_timesheet_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dayType" "TimesheetDayType" NOT NULL DEFAULT 'WORKED',
    "hoursWorked" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "enteredByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "paymentNumber" TEXT,
    "category" "EmployeePaymentCategory" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "bankCashAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "recoveredAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payment_recoveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeePaymentId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "recoveryDate" TIMESTAMP(3) NOT NULL,
    "bankCashAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_payment_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_timesheet_entries_companyId_date_idx" ON "employee_timesheet_entries"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_timesheet_entries_employeeId_date_key" ON "employee_timesheet_entries"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payments_journalEntryId_key" ON "employee_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "employee_payments_employeeId_category_idx" ON "employee_payments"("employeeId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payments_companyId_paymentNumber_key" ON "employee_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payment_recoveries_journalEntryId_key" ON "employee_payment_recoveries"("journalEntryId");

-- CreateIndex
CREATE INDEX "employee_payment_recoveries_employeePaymentId_idx" ON "employee_payment_recoveries"("employeePaymentId");

-- AddForeignKey
ALTER TABLE "employee_timesheet_entries" ADD CONSTRAINT "employee_timesheet_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_timesheet_entries" ADD CONSTRAINT "employee_timesheet_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_bankCashAccountId_fkey" FOREIGN KEY ("bankCashAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payment_recoveries" ADD CONSTRAINT "employee_payment_recoveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payment_recoveries" ADD CONSTRAINT "employee_payment_recoveries_employeePaymentId_fkey" FOREIGN KEY ("employeePaymentId") REFERENCES "employee_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payment_recoveries" ADD CONSTRAINT "employee_payment_recoveries_bankCashAccountId_fkey" FOREIGN KEY ("bankCashAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payment_recoveries" ADD CONSTRAINT "employee_payment_recoveries_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

