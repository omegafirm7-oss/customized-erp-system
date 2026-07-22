import { ApiProperty } from "@nestjs/swagger";
import { VatCategory } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

export class PurchaseOrderLineDto {
  @ApiProperty({ required: false, description: "Optional item reference — fills description defaults" })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsNumberString()
  quantity!: string;

  @ApiProperty()
  @IsNumberString()
  unitPrice!: string;

  @ApiProperty({ enum: VatCategory, required: false })
  @IsOptional()
  @IsEnum(VatCategory)
  vatCategory?: VatCategory;

  @ApiProperty({ required: false, description: "Warehouse for inventory items — carried onto the generated invoice line" })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ required: false, description: "Cost-center dimension — carried onto the generated invoice line" })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty()
  @IsDateString()
  orderDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class GeneratePurchaseInvoiceDto {
  @ApiProperty({ description: "The supplier's own invoice number — unique per vendor" })
  @IsString()
  vendorInvoiceNumber!: string;

  @ApiProperty()
  @IsDateString()
  postingDate!: string;

  @ApiProperty()
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}
