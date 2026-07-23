import { ApiProperty } from "@nestjs/swagger";
import { ProjectStatus, RecognitionMethod } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class CreateProjectDto {
  @ApiProperty({ description: "Unique per company; also names the auto cost center PRJ-<code>" })
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
  description?: string;

  @ApiProperty({ required: false, description: "Customer (CUSTOMER/BOTH partner)" })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;

  @ApiProperty({ enum: RecognitionMethod, default: RecognitionMethod.POINT_IN_TIME })
  @IsOptional()
  @IsEnum(RecognitionMethod)
  recognitionMethod?: RecognitionMethod;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false, description: "Functional currency" })
  @IsOptional()
  @IsNumberString()
  contractValue?: string;

  @ApiProperty({ required: false, description: "Cost-to-cost POC basis (functional)" })
  @IsOptional()
  @IsNumberString()
  estimatedTotalCost?: string;
}

export class UpdateProjectDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  contractValue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  estimatedTotalCost?: string;
}

export class TransitionStatusDto {
  @ApiProperty({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;
}

export class CreateWbsTaskDto {
  @ApiProperty({ description: "Unique per project" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  costBudget?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateWbsTaskDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  costBudget?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateCostCenterDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;
}

export class UpdateCostCenterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}

export class RunRevRecDto {
  @ApiProperty()
  @IsUUID()
  fiscalPeriodId!: string;
}
