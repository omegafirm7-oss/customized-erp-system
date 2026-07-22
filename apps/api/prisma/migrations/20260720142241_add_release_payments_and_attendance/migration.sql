-- AlterTable
ALTER TABLE "final_settlements" ADD COLUMN     "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "settlement_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "finalSettlementId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "bankCashAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "daysWorked" DECIMAL(5,2) NOT NULL,
    "enteredByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_payments_journalEntryId_key" ON "settlement_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "settlement_payments_finalSettlementId_idx" ON "settlement_payments"("finalSettlementId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_attendance_employeeId_fiscalPeriodId_key" ON "employee_attendance"("employeeId", "fiscalPeriodId");

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_finalSettlementId_fkey" FOREIGN KEY ("finalSettlementId") REFERENCES "final_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_bankCashAccountId_fkey" FOREIGN KEY ("bankCashAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
