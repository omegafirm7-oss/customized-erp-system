import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { InvoiceLineDto } from "./invoice-line.dto";

/** A line in an edit payload; `sourceLineId` names the saved line it replaces so that line's evidence file is carried over. */
export class UpdateInvoiceLineDto extends InvoiceLineDto {
  @ApiProperty({ required: false, description: "Existing line this one replaces — its evidence file is carried over" })
  @IsOptional()
  @IsUUID()
  sourceLineId?: string;
}

/**
 * Full replace for a DRAFT purchase invoice's lines (delete-then-rebuild,
 * mirroring createDraft's own line-building path) plus optional header edits.
 */
export class UpdatePurchaseInvoiceDto {
  @ApiProperty({ required: false, description: "Move this draft to a different vendor" })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;

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

  @ApiProperty({ type: [UpdateInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceLineDto)
  lines!: UpdateInvoiceLineDto[];
}
