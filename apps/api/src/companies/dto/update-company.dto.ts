import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";
import { FBR_BUSINESS_ACTIVITIES, FBR_SECTORS, NTN_CNIC_REGEX, PK_PROVINCES } from "../../fbr/fbr-constants";

export class UpdateCompanyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiProperty({ required: false, description: "15 digits, starts and ends with 3 (ZATCA)" })
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  crNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ required: false, description: "4-digit building number (ZATCA)" })
  @IsOptional()
  @IsString()
  buildingNumber?: string;

  @ApiProperty({ required: false, description: "District / CitySubdivisionName (ZATCA)" })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  additionalNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false, description: "5-digit postal code (ZATCA)" })
  @IsOptional()
  @IsString()
  postalCode?: string;

  // ── Pakistan (FBR) seller identity ────────────────────────────────
  @ApiProperty({ required: false, description: "Seller NTN (7 digits) or CNIC (13 digits) — FBR DI sellerNTNCNIC" })
  @IsOptional()
  @Matches(NTN_CNIC_REGEX, { message: "NTN must be 7 digits (or CNIC 13 digits), numbers only" })
  ntn?: string;

  @ApiProperty({ required: false, description: "Sales Tax Registration Number" })
  @IsOptional()
  @IsString()
  strn?: string;

  @ApiProperty({ required: false, enum: PK_PROVINCES })
  @IsOptional()
  @IsIn(PK_PROVINCES)
  province?: string;

  @ApiProperty({ required: false, enum: FBR_BUSINESS_ACTIVITIES })
  @IsOptional()
  @IsIn(FBR_BUSINESS_ACTIVITIES)
  fbrBusinessActivity?: string;

  @ApiProperty({ required: false, enum: FBR_SECTORS })
  @IsOptional()
  @IsIn(FBR_SECTORS)
  fbrSector?: string;
}
