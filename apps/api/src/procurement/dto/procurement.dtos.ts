import { ApiProperty } from "@nestjs/swagger";
import { QualityCheckResult } from "@prisma/client";
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

// ── Requisitions ──────────────────────────────────────────────────────────

export class PurchaseRequisitionLineDto {
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

  @ApiProperty({ required: false, description: "Informational only — not authoritative; the RFQ/PO carry the real price" })
  @IsOptional()
  @IsNumberString()
  estimatedUnitPrice?: string;
}

export class CreatePurchaseRequisitionDto {
  @ApiProperty({ required: false, description: "Optional cost accountability" })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [PurchaseRequisitionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequisitionLineDto)
  lines!: PurchaseRequisitionLineDto[];
}

export class RejectRequisitionDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}

export class SendRfqDto {
  @ApiProperty({ description: "Vendor to send this RFQ to" })
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty()
  @IsDateString()
  quotationDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

// ── Goods receipts ────────────────────────────────────────────────────────

export class CreateGoodsReceiptDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty()
  @IsDateString()
  receivedDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateReceiptLineDto {
  @ApiProperty()
  @IsNumberString()
  quantityReceived!: string;
}

export class RecordQcDto {
  @ApiProperty({ enum: QualityCheckResult })
  @IsEnum(QualityCheckResult)
  qcResult!: QualityCheckResult;

  @ApiProperty()
  @IsNumberString()
  quantityAccepted!: string;

  @ApiProperty()
  @IsNumberString()
  quantityRejected!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  qcNotes?: string;
}
