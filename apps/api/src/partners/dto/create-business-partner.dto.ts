import { ApiProperty } from "@nestjs/swagger";
import { PartnerType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

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
}

export class ImportPartnersDto {
  @ApiProperty({ description: "Raw CSV content matching the downloadable template" })
  @IsString()
  @MinLength(1)
  csv!: string;
}
