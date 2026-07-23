import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, ValidateNested } from "class-validator";
import { InvoiceLineDto } from "./invoice-line.dto";

/**
 * Full replace for a DRAFT purchase invoice's lines (delete-then-rebuild,
 * mirroring createDraft's own line-building path) plus optional header edits.
 */
export class UpdatePurchaseInvoiceDto {
  @ApiProperty({ required: false, description: "The supplier's own invoice number — unique per vendor" })
  @IsOptional()
  @IsString()
  vendorInvoiceNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
