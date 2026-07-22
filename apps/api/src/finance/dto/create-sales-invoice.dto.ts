import { ApiProperty } from "@nestjs/swagger";
import { SalesDocumentKind } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { InvoiceLineDto } from "./invoice-line.dto";

export class CreateSalesInvoiceDto {
  @ApiProperty({ enum: SalesDocumentKind, default: SalesDocumentKind.INVOICE })
  @IsOptional()
  @IsEnum(SalesDocumentKind)
  documentKind?: SalesDocumentKind;

  @ApiProperty()
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty({ required: false, description: "Required when documentKind is CREDIT_NOTE" })
  @IsOptional()
  @IsUUID()
  originalInvoiceId?: string;

  @ApiProperty()
  @IsDateString()
  issueDateTime!: string;

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

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
