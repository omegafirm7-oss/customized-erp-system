import { ApiProperty, OmitType, PartialType } from "@nestjs/swagger";
import { ItemType, VatCategory } from "@prisma/client";
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { HS_CODE_REGEX } from "../../fbr/fbr-constants";

export class CreateItemDto {
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

  @ApiProperty({ enum: ItemType })
  @IsEnum(ItemType)
  itemType!: ItemType;

  @ApiProperty()
  @IsUUID()
  baseUoMId!: string;

  @ApiProperty({ enum: VatCategory, required: false, description: "Defaults to STANDARD_15 (SA) / PK_STANDARD (PK)" })
  @IsOptional()
  @IsEnum(VatCategory)
  vatCategory?: VatCategory;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isSalesItem?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPurchaseItem?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isInventoryItem?: boolean;

  @ApiProperty({ required: false, description: "Default revenue account for AR invoice lines" })
  @IsOptional()
  @IsUUID()
  defaultSalesAccountId?: string;

  @ApiProperty({ required: false, description: "Default expense account for AP invoice lines" })
  @IsOptional()
  @IsUUID()
  defaultPurchaseAccountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  defaultInventoryAccountId?: string;

  // ── Pakistan (FBR) ────────────────────────────────────────────────
  @ApiProperty({ required: false, description: 'HS code "####.####" (FBR DI hsCode; POS PCTCode drops the dot)' })
  @IsOptional()
  @Matches(HS_CODE_REGEX, { message: 'HS code must look like "0101.2100"' })
  hsCode?: string;

  @ApiProperty({ required: false, description: "FBR UoM description, e.g. \"Numbers, pieces, units\" or \"KG\"" })
  @IsOptional()
  @IsString()
  fbrUom?: string;

  @ApiProperty({ required: false, description: "Override of the DI saleType text (e.g. \"Services\")" })
  @IsOptional()
  @IsString()
  fbrSaleType?: string;

  @ApiProperty({ required: false, description: "Reduced sales tax rate percent — required for PK_REDUCED" })
  @IsOptional()
  @IsNumberString()
  reducedRate?: string;

  @ApiProperty({ required: false, description: "Printed retail price per base unit — required for PK_THIRD_SCHEDULE" })
  @IsOptional()
  @IsNumberString()
  retailPrice?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sroScheduleNo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sroItemSerialNo?: string;

  @ApiProperty({ required: false, description: "Default tax-inclusive selling price (POS counter prefill)" })
  @IsOptional()
  @IsNumberString()
  defaultSalesPrice?: string;
}

export class UpdateItemDto extends PartialType(OmitType(CreateItemDto, ["code"] as const)) {}
