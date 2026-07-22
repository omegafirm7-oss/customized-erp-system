import { ApiProperty } from "@nestjs/swagger";
import { ItemType, VatCategory } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

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

  @ApiProperty({ enum: VatCategory, required: false, default: VatCategory.STANDARD_15 })
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
}
