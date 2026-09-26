import { ApiProperty } from "@nestjs/swagger";
import { FbrRegistrationType, PartnerType } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { NTN_CNIC_REGEX, PK_PROVINCES } from "../../fbr/fbr-constants";

export class CreateBusinessPartnerDto {
  @ApiProperty()
  @IsString()
  code!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty({ enum: PartnerType })
  @IsEnum(PartnerType)
  partnerType!: PartnerType;

  @ApiProperty({ required: false, description: "VAT/TRN — required for B2B ZATCA invoices in a later phase" })
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  commercialRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currencyCode?: string;

  // ── Pakistan (FBR) buyer identity ─────────────────────────────────
  @ApiProperty({ required: false, description: "Buyer NTN (7 digits) or CNIC (13 digits)" })
  @IsOptional()
  @Matches(NTN_CNIC_REGEX, { message: "NTN must be 7 digits (or CNIC 13 digits), numbers only" })
  ntnCnic?: string;

  @ApiProperty({ required: false, description: "Sales Tax Registration Number" })
  @IsOptional()
  @IsString()
  strn?: string;

  @ApiProperty({ required: false, enum: PK_PROVINCES })
  @IsOptional()
  @IsIn(PK_PROVINCES)
  province?: string;

  @ApiProperty({ required: false, enum: FbrRegistrationType, description: "UNREGISTERED buyers attract further tax" })
  @IsOptional()
  @IsEnum(FbrRegistrationType)
  fbrRegistrationType?: FbrRegistrationType;
}

export class UpdateBusinessPartnerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty({ enum: PartnerType, required: false })
  @IsOptional()
  @IsEnum(PartnerType)
  partnerType?: PartnerType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  commercialRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currencyCode?: string;

  // ── Pakistan (FBR) buyer identity ─────────────────────────────────
  @ApiProperty({ required: false, description: "Buyer NTN (7 digits) or CNIC (13 digits)" })
  @IsOptional()
  @Matches(NTN_CNIC_REGEX, { message: "NTN must be 7 digits (or CNIC 13 digits), numbers only" })
  ntnCnic?: string;

  @ApiProperty({ required: false, description: "Sales Tax Registration Number" })
  @IsOptional()
  @IsString()
  strn?: string;

  @ApiProperty({ required: false, enum: PK_PROVINCES })
  @IsOptional()
  @IsIn(PK_PROVINCES)
  province?: string;

  @ApiProperty({ required: false, enum: FbrRegistrationType, description: "UNREGISTERED buyers attract further tax" })
  @IsOptional()
  @IsEnum(FbrRegistrationType)
  fbrRegistrationType?: FbrRegistrationType;
}

export class ImportPartnersDto {
  @ApiProperty({ description: "Raw CSV content matching the downloadable template" })
  @IsString()
  @MinLength(1)
  csv!: string;
}
