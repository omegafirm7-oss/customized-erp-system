import { ApiProperty } from "@nestjs/swagger";
import { RateBasis, UsageDayType } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class CreateEquipmentDto {
  @ApiProperty({ description: "Unique per company" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiProperty()
  @IsDateString()
  acquisitionDate!: string;

  @ApiProperty()
  @IsNumberString()
  acquisitionCost!: string;

  @ApiProperty({ required: false, default: "0" })
  @IsOptional()
  @IsNumberString()
  salvageValue?: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  usefulLifeMonths!: number;

  @ApiProperty({ required: false, description: "Defaults to acquisitionDate" })
  @IsOptional()
  @IsDateString()
  depreciationStartDate?: string;

  @ApiProperty({ required: false, description: "For assets bought used / migrated" })
  @IsOptional()
  @IsNumberString()
  openingAccumulatedDepreciation?: string;

  @ApiProperty({
    required: false,
    description: "BANK/CASH account to credit for a capitalization JE (Dr 1512). Omit if already on the books.",
  })
  @IsOptional()
  @IsUUID()
  capitalizationCreditAccountId?: string;
}

export class UpdateEquipmentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serialNumber?: string;
}

export class DisposeEquipmentDto {
  @ApiProperty({ description: "Sale proceeds (0 = scrapped)" })
  @IsNumberString()
  proceeds!: string;

  @ApiProperty({ description: "BANK/CASH account receiving the proceeds" })
  @IsUUID()
  proceedsAccountId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  disposalDate?: string;
}

export class CreateEquipmentContractDto {
  @ApiProperty({ description: "Unique per company; also names the auto cost center EQR-<code>" })
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

export class CreateEquipmentAssignmentDto {
  @ApiProperty()
  @IsUUID()
  equipmentId!: string;

  @ApiProperty({ enum: RateBasis })
  @IsEnum(RateBasis)
  rateBasis!: RateBasis;

  @ApiProperty()
  @IsNumberString()
  billRate!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateEquipmentAssignmentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  billRate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateUsageLogDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}

export class UpsertUsageEntryDto {
  @ApiProperty()
  @IsUUID()
  assignmentId!: string;

  @ApiProperty({ description: "Calendar date within the log's fiscal period (YYYY-MM-DD)" })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: UsageDayType })
  @IsEnum(UsageDayType)
  dayStatus!: UsageDayType;

  @ApiProperty({ required: false, description: "Metered hours (HOURLY-basis billing)" })
  @IsOptional()
  @IsNumberString()
  hoursUsed?: string;

  @ApiProperty({
    required: false,
    description: "Overtime hours for the day. Recorded and reported only — never feeds billing.",
  })
  @IsOptional()
  @IsNumberString()
  overtimeHours?: string;
}

export class RunDepreciationDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}
