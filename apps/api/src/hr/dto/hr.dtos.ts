import { ApiProperty, PartialType } from "@nestjs/swagger";
import { ContractType, EmployeePaymentCategory, EosbBasis, SettlementReason, TimesheetDayType } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class UpdateHrSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  saudiEmployeeRatePct?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  saudiEmployerRatePct?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  expatEmployerRatePct?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  gosiWageFloor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  gosiWageCap?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  overtimeMultiplier?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  hoursPerDay?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  daysPerMonth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  defaultAnnualLeaveDays?: string;

  @ApiProperty({ required: false, enum: EosbBasis })
  @IsOptional()
  @IsEnum(EosbBasis)
  eosbBasis?: EosbBasis;

  @ApiProperty({ required: false, description: "MOL establishment ID for WPS SIF files" })
  @IsOptional()
  @IsString()
  molEstablishmentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  employerBankCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  employerIban?: string;

  @ApiProperty({
    required: false,
    description:
      "Company-specific override: when true, final settlements skip EOSB and leave payout — net amount is just accrued-but-unpaid timesheet wages minus loan recovery",
  })
  @IsOptional()
  @IsBoolean()
  settlementExcludesEosbAndLeave?: boolean;
}

export class CreateEmployeeDto {
  @ApiProperty({ description: "Unique per company" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty({ required: false, description: "Job title / trade, e.g. Mason, Electrician, Site Supervisor" })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiProperty({ default: false, description: "Drives GOSI treatment" })
  @IsOptional()
  @IsBoolean()
  isSaudi?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  iqamaOrNationalId?: string;

  @ApiProperty({ required: false, description: "WhatsApp/SMS contact number for sending documents directly to the worker" })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  iqamaExpiry?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  passportNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  passportExpiry?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  gosiNumber?: string;

  @ApiProperty()
  @IsDateString()
  joinDate!: string;

  @ApiProperty({ required: false, enum: ContractType })
  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @ApiProperty({ required: false, description: "WPS bank code (SARIE)" })
  @IsOptional()
  @IsString()
  bankCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  iban?: string;

  @ApiProperty({ required: false, description: "Default cost dimension; may be a project cost center" })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  annualLeaveDays?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  leaveOpeningBalance?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  basicSalary?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  housingAllowance?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  transportAllowance?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  otherAllowance?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  gosiExempt?: boolean;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class ImportEmployeesDto {
  @ApiProperty({ description: "Raw CSV content matching the downloadable template" })
  @IsString()
  @MinLength(1)
  csv!: string;
}

export class CreateLoanDto {
  @ApiProperty()
  @IsNumberString()
  principal!: string;

  @ApiProperty()
  @IsNumberString()
  monthlyInstallment!: string;

  @ApiProperty({ description: "BANK or CASH control account the disbursement is paid from" })
  @IsUUID()
  disbursementAccountId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  disbursementDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class CreatePayrollRunDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}

export class UpdatePayrollLineDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  unpaidDays?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  absentDays?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  overtimeHours?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  annualLeaveDaysTaken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  otherDeduction?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  otherDeductionMemo?: string;
}

export class TerminationPreviewDto {
  @ApiProperty({ enum: SettlementReason })
  @IsEnum(SettlementReason)
  reason!: SettlementReason;

  @ApiProperty()
  @IsDateString()
  lastWorkingDay!: string;
}

export class PostSettlementDto extends TerminationPreviewDto {}

export class RecordSettlementPaymentDto {
  @ApiProperty()
  @IsNumberString()
  amount!: string;

  @ApiProperty({ description: "BANK or CASH control account the payout is paid from" })
  @IsUUID()
  bankCashAccountId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class PrefillTimesheetDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}

export class UpsertTimesheetEntryDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ description: "Calendar day (YYYY-MM-DD)" })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: TimesheetDayType })
  @IsEnum(TimesheetDayType)
  dayType!: TimesheetDayType;

  @ApiProperty({ required: false, description: "Overrides the dayType default (10 for WORKED, 0 otherwise)" })
  @IsOptional()
  @IsNumberString()
  hoursWorked?: string;

  @ApiProperty({
    required: false,
    description: "Overtime hours for the day. Recorded and reported only — never feeds payroll or accrued labor cost.",
  })
  @IsOptional()
  @IsNumberString()
  overtimeHours?: string;
}

export class CreateEmployeePaymentDto {
  @ApiProperty({ enum: EmployeePaymentCategory })
  @IsEnum(EmployeePaymentCategory)
  category!: EmployeePaymentCategory;

  @ApiProperty()
  @IsNumberString()
  amount!: string;

  @ApiProperty({ description: "BANK or CASH control account the payment is paid from" })
  @IsUUID()
  bankCashAccountId!: string;

  @ApiProperty({
    required: false,
    description: "Expense account to allocate this ALLOWANCE payment to; defaults to the company's ALLOWANCE_EXPENSE control account when omitted. Ignored for ADVANCE/OTHER.",
  })
  @IsOptional()
  @IsUUID()
  expenseAccountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class RecordPaymentRecoveryDto {
  @ApiProperty()
  @IsNumberString()
  amount!: string;

  @ApiProperty({ description: "BANK or CASH control account the recovery is received into" })
  @IsUUID()
  bankCashAccountId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  recoveryDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class ReclassifyPaymentAccountDto {
  @ApiProperty({ description: "New expense account to move this payment's posting to" })
  @IsUUID()
  expenseAccountId!: string;
}
