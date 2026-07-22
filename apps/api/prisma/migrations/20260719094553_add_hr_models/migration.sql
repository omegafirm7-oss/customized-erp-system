-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('UNLIMITED', 'LIMITED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EosbBasis" AS ENUM ('BASIC_ONLY', 'BASIC_HOUSING', 'FULL_GROSS');

-- CreateEnum
CREATE TYPE "SettlementReason" AS ENUM ('RESIGNATION', 'TERMINATION_BY_EMPLOYER', 'CONTRACT_END');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('POSTED', 'REVERSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ControlAccountType" ADD VALUE 'EMPLOYEE_LOANS';
ALTER TYPE "ControlAccountType" ADD VALUE 'SALARIES_PAYABLE';
ALTER TYPE "ControlAccountType" ADD VALUE 'GOSI_PAYABLE';
ALTER TYPE "ControlAccountType" ADD VALUE 'EOSB_PROVISION';
ALTER TYPE "ControlAccountType" ADD VALUE 'LEAVE_PROVISION';
ALTER TYPE "ControlAccountType" ADD VALUE 'SALARY_EXPENSE';
ALTER TYPE "ControlAccountType" ADD VALUE 'GOSI_EXPENSE';
ALTER TYPE "ControlAccountType" ADD VALUE 'EOSB_EXPENSE';
ALTER TYPE "ControlAccountType" ADD VALUE 'LEAVE_EXPENSE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'PAYROLL_RUN';
ALTER TYPE "DocumentType" ADD VALUE 'EMPLOYEE_LOAN';
ALTER TYPE "DocumentType" ADD VALUE 'FINAL_SETTLEMENT';

-- CreateTable
CREATE TABLE "hr_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saudiEmployeeRatePct" DECIMAL(7,4) NOT NULL DEFAULT 9.75,
    "saudiEmployerRatePct" DECIMAL(7,4) NOT NULL DEFAULT 11.75,
    "expatEmployerRatePct" DECIMAL(7,4) NOT NULL DEFAULT 2,
    "gosiWageFloor" DECIMAL(18,4) NOT NULL DEFAULT 1500,
    "gosiWageCap" DECIMAL(18,4) NOT NULL DEFAULT 45000,
    "overtimeMultiplier" DECIMAL(7,4) NOT NULL DEFAULT 1.5,
    "hoursPerDay" DECIMAL(7,2) NOT NULL DEFAULT 8,
    "daysPerMonth" DECIMAL(7,2) NOT NULL DEFAULT 30,
    "defaultAnnualLeaveDays" DECIMAL(7,2) NOT NULL DEFAULT 21,
    "eosbBasis" "EosbBasis" NOT NULL DEFAULT 'FULL_GROSS',
    "molEstablishmentId" TEXT,
    "employerBankCode" TEXT,
    "employerIban" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "nationality" TEXT,
    "isSaudi" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "iqamaOrNationalId" TEXT,
    "iqamaExpiry" TIMESTAMP(3),
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "gosiNumber" TEXT,
    "joinDate" TIMESTAMP(3) NOT NULL,
    "contractType" "ContractType" NOT NULL DEFAULT 'UNLIMITED',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminationDate" TIMESTAMP(3),
    "bankCode" TEXT,
    "iban" TEXT,
    "costCenterId" TEXT,
    "annualLeaveDays" DECIMAL(7,2) NOT NULL DEFAULT 21,
    "leaveOpeningBalance" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "basicSalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "housingAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gosiExempt" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "loanNumber" TEXT NOT NULL,
    "principal" DECIMAL(18,4) NOT NULL,
    "monthlyInstallment" DECIMAL(18,4) NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "disbursementJournalEntryId" TEXT NOT NULL,
    "disbursementAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "runNumber" TEXT,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "totalGross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalGosiEmployee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalGosiEmployer" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalLoanDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalNetPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalEosbDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalLeaveDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(18,4) NOT NULL,
    "housingAllowance" DECIMAL(18,4) NOT NULL,
    "transportAllowance" DECIMAL(18,4) NOT NULL,
    "otherAllowance" DECIMAL(18,4) NOT NULL,
    "gosiBase" DECIMAL(18,4) NOT NULL,
    "gosiEmployee" DECIMAL(18,4) NOT NULL,
    "gosiEmployer" DECIMAL(18,4) NOT NULL,
    "unpaidDays" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "absentDays" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "annualLeaveDaysTaken" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "otherDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherDeductionMemo" TEXT,
    "overtimePay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "absenceDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "loanDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eosbEntitlementToDate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "eosbDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "leaveBalanceDays" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "leaveProvisionToDate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "leaveDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_settlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "settlementNumber" TEXT NOT NULL,
    "reason" "SettlementReason" NOT NULL,
    "lastWorkingDay" TIMESTAMP(3) NOT NULL,
    "serviceYears" DECIMAL(7,4) NOT NULL,
    "finalSalaryAmount" DECIMAL(18,4) NOT NULL,
    "eosbAmount" DECIMAL(18,4) NOT NULL,
    "leavePayoutAmount" DECIMAL(18,4) NOT NULL,
    "loanRecovery" DECIMAL(18,4) NOT NULL,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "eosbProvisionCleared" DECIMAL(18,4) NOT NULL,
    "leaveProvisionCleared" DECIMAL(18,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "reversalJournalEntryId" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'POSTED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_settings_companyId_key" ON "hr_settings"("companyId");

-- CreateIndex
CREATE INDEX "employees_companyId_status_idx" ON "employees"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_code_key" ON "employees"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_disbursementJournalEntryId_key" ON "employee_loans"("disbursementJournalEntryId");

-- CreateIndex
CREATE INDEX "employee_loans_employeeId_status_idx" ON "employee_loans"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_companyId_loanNumber_key" ON "employee_loans"("companyId", "loanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_journalEntryId_key" ON "payroll_runs"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_reversalJournalEntryId_key" ON "payroll_runs"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "payroll_runs_companyId_fiscalPeriodId_idx" ON "payroll_runs"("companyId", "fiscalPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_companyId_runNumber_key" ON "payroll_runs"("companyId", "runNumber");

-- CreateIndex
CREATE INDEX "payroll_run_lines_companyId_employeeId_idx" ON "payroll_run_lines"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_runId_employeeId_key" ON "payroll_run_lines"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_employeeId_key" ON "final_settlements"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_journalEntryId_key" ON "final_settlements"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_reversalJournalEntryId_key" ON "final_settlements"("reversalJournalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_companyId_settlementNumber_key" ON "final_settlements"("companyId", "settlementNumber");

-- AddForeignKey
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursementJournalEntryId_fkey" FOREIGN KEY ("disbursementJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursementAccountId_fkey" FOREIGN KEY ("disbursementAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
