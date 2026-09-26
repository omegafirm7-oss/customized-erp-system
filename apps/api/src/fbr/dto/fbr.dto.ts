import { ApiProperty } from "@nestjs/swagger";
import { FbrChannel, FbrEnvironment, FbrSubmissionStatus } from "@prisma/client";
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, IsUUID, ValidateIf } from "class-validator";

export class UpdateFbrSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, enum: FbrEnvironment })
  @IsOptional()
  @IsEnum(FbrEnvironment)
  environment?: FbrEnvironment;

  @ApiProperty({ required: false, description: "PRAL Digital Invoicing bearer token; empty string clears it" })
  @IsOptional()
  @IsString()
  diToken?: string;

  @ApiProperty({ required: false, description: "FBR POS (IMS) bearer token; empty string clears it" })
  @IsOptional()
  @IsString()
  posToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  furtherTaxRatePercent?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  posFeeAmount?: string;

  @ApiProperty({ required: false, description: "Sales tax rate on services (e.g. Islamabad Capital Territory)" })
  @IsOptional()
  @IsNumberString()
  servicesTaxRatePercent?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== "" && value !== null)
  @IsUUID()
  posFeeAccountId?: string | null;
}

export class ListFbrSubmissionsQuery {
  @IsOptional()
  @IsEnum(FbrSubmissionStatus)
  status?: FbrSubmissionStatus;

  @IsOptional()
  @IsEnum(FbrChannel)
  channel?: FbrChannel;
}
