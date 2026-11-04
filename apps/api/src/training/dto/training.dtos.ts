import { ApiProperty, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { TrainingBatchStatus, TrainingResult } from "@prisma/client";

export class UpdateTrainingSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  certificatePrefix?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryTitle?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  certificateFooterText?: string;
}

export class CreateCourseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationDays?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  durationHours?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerTrainee?: number;

  @ApiProperty({ required: false, default: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  validityMonths?: number;

  @ApiProperty({ required: false, default: 70 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passMarkPercent?: number;

  @ApiProperty({ required: false, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  theoryMaxMarks?: number;

  @ApiProperty({ required: false, default: 100, description: "0 = no practical assessment" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  practicalMaxMarks?: number;

  @ApiProperty({ required: false, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minAttendancePercent?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {}

export const TRAINEE_ID_TYPES = ["IQAMA", "NATIONAL_ID", "PASSPORT", "OTHER"] as const;

export class CreateTraineeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullNameAr?: string;

  @ApiProperty({ required: false, enum: TRAINEE_ID_TYPES })
  @IsOptional()
  @IsIn(TRAINEE_ID_TYPES as unknown as string[])
  idType?: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  idNumber!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, description: "YYYY-MM-DD" })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiProperty({ required: false, description: "Customer (Partners) the trainee works for" })
  @IsOptional()
  @IsUUID()
  employerPartnerId?: string;

  @ApiProperty({ required: false, description: "Employer name when not a customer in Partners" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  employerName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTraineeDto extends PartialType(CreateTraineeDto) {}

export class CreateBatchDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({ description: "YYYY-MM-DD" })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: "YYYY-MM-DD" })
  @IsDateString()
  endDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instructorName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateBatchDto extends PartialType(CreateBatchDto) {
  @ApiProperty({ required: false, enum: TrainingBatchStatus })
  @IsOptional()
  @IsEnum(TrainingBatchStatus)
  status?: TrainingBatchStatus;
}

export class EnrollTraineesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID("all", { each: true })
  traineeIds!: string[];
}

export class AttendanceEntryDto {
  @ApiProperty()
  @IsUUID()
  enrollmentId!: string;

  @ApiProperty({ description: "YYYY-MM-DD" })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsBoolean()
  present!: boolean;
}

export class SaveAttendanceDto {
  @ApiProperty({ type: [AttendanceEntryDto] })
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}

export class MarksEntryDto {
  @ApiProperty()
  @IsUUID()
  enrollmentId!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  theoryMarks?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  practicalMarks?: number | null;

  @ApiProperty({ required: false, enum: TrainingResult, description: "Set to override the automatic result; omit/null to use it" })
  @IsOptional()
  @IsEnum(TrainingResult)
  resultOverride?: TrainingResult | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class SaveMarksDto {
  @ApiProperty({ type: [MarksEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MarksEntryDto)
  entries!: MarksEntryDto[];
}

export class IssueCertificatesDto {
  @ApiProperty({ required: false, description: "YYYY-MM-DD; defaults to the batch end date" })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiProperty({ required: false, type: [String], description: "Limit to these enrollments; default = every passed trainee without a certificate" })
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  enrollmentIds?: string[];
}

export class UpdateCertificateDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  externalCardNo?: string | null;
}

export class RevokeCertificateDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
