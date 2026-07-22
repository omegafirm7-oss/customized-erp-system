import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class CreateCompanyDto {
  @ApiProperty()
  @IsString()
  @Length(2, 20)
  code!: string;

  @ApiProperty()
  @IsString()
  legalName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiProperty({ description: "ISO 3166-1 alpha-2, e.g. SA" })
  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @ApiProperty({ description: "ISO 4217, e.g. SAR" })
  @IsString()
  @Length(3, 3)
  baseCurrency!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  crNumber?: string;
}
