import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { InvoiceLineDto } from "./invoice-line.dto";

export class CreatePurchaseInvoiceDto {
  @ApiProperty()
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty({ description: "The supplier's own invoice number — unique per vendor" })
  @IsString()
  vendorInvoiceNumber!: string;

  @ApiProperty()
  @IsDateString()
  postingDate!: string;

  @ApiProperty()
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ required: false, description: "ISO 4217; defaults to company base currency" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ required: false, description: "Set when this invoice is generated from a Purchase Order" })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
