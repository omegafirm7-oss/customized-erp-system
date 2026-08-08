import { ApiProperty } from "@nestjs/swagger";
import { LeadSource } from "@prisma/client";
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: LeadSource, required: false })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, description: "Defaults to the creator" })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}
