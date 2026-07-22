import { ApiProperty } from "@nestjs/swagger";
import { RateBasis, TimesheetDayType } from "@prisma/client";
import { IsBoolean, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateContractDto {
  @ApiProperty({ description: "Unique per company; also names the auto cost center MPR-<code>" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: "Customer (CUSTOMER/BOTH partner)" })
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateContractDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: RateBasis })
  @IsEnum(RateBasis)
  rateBasis!: RateBasis;

  @ApiProperty()
  @IsNumberString()
  billRate!: string;

  @ApiProperty({ required: false, description: "0 = overtime not billable" })
  @IsOptional()
  @IsNumberString()
  otBillRate?: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateAssignmentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  billRate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  otBillRate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTimesheetDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}

export class UpsertEntryDto {
  @ApiProperty()
  @IsUUID()
  assignmentId!: string;

  @ApiProperty({ description: "Calendar date within the timesheet's fiscal period (YYYY-MM-DD)" })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: TimesheetDayType })
  @IsEnum(TimesheetDayType)
  dayType!: TimesheetDayType;

  @ApiProperty({ required: false, description: "Hours worked (HOURLY-basis billing)" })
  @IsOptional()
  @IsNumberString()
  hours?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  overtimeHours?: string;
}
