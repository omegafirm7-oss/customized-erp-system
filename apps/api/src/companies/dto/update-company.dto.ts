import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

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
}
