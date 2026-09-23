import { ApiProperty } from "@nestjs/swagger";
import { LeadPriority } from "@prisma/client";
import { IsArray, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength } from "class-validator";

/** Sales-agent fields shared by CreateLeadDto and UpdateLeadDto (TUV card / safety-training outreach). */
export class LeadSalesFieldsDto {
  @ApiProperty({ enum: LeadPriority, required: false })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiProperty({ required: false, type: [String], example: ["training", "manpower"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  businessLines?: string[];

  @ApiProperty({ required: false, type: [String], example: ["TUV Safety Card", "H2S Alive"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  safetyCertsRequired?: string[];

  @ApiProperty({ required: false, example: "Grade 3" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contractorGrade?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyWebsite?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  projectName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false, description: "SAR" })
  @IsOptional()
  @IsNumberString()
  estimatedValue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;
}
