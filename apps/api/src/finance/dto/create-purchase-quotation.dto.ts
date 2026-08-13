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

export class PurchaseQuotationLineDto {
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
}

export class CreatePurchaseQuotationDto {
  @ApiProperty()
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty()
  @IsDateString()
  quotationDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ required: false, description: "Requisition this RFQ was raised from — enables multi-vendor comparison" })
  @IsOptional()
  @IsUUID()
  sourceRequisitionId?: string;

  @ApiProperty({ type: [PurchaseQuotationLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseQuotationLineDto)
  lines!: PurchaseQuotationLineDto[];
}
