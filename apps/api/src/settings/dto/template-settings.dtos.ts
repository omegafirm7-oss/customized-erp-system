import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpdateTemplateSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  headerTagline?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  headerMissionLine?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  footerText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showAddressInHeader?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showTaxNumberInHeader?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timesheetTitle?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  timesheetShowIqama?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  timesheetShowDesignation?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  salesShowItemCode?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  salesShowVatBreakdown?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  salesTermsText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  purchaseShowItemCode?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  purchaseShowVatBreakdown?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  purchaseTermsText?: string;
}
