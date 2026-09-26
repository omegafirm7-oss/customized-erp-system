import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";
import { NTN_CNIC_REGEX } from "../../fbr/fbr-constants";

// ── Inbound API (called by the client's POS software) ────────────────

export class PosSaleLineDto {
  @ApiProperty({ description: "ERP item code (must carry an HS code)" })
  @IsString()
  itemCode!: string;

  @ApiProperty({ example: "2" })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({ example: "118.00", description: "Per unit; tax-inclusive unless pricesIncludeTax=false" })
  @IsNumberString()
  unitPrice!: string;

  @ApiProperty({ required: false, example: "0" })
  @IsOptional()
  @IsNumberString()
  discountAmount?: string;
}

export class PosBuyerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, description: "NTN (7 digits) or CNIC (13 digits)" })
  @IsOptional()
  @Matches(NTN_CNIC_REGEX, { message: "ntnCnic must be 7 digits (NTN) or 13 digits (CNIC)" })
  ntnCnic?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class CreatePosSaleDto {
  @ApiProperty({ description: "The POS's own unique id for this sale — resending the same id is idempotent" })
  @IsString()
  @Length(1, 64)
  clientSaleId!: string;

  @ApiProperty({ required: false, description: "ISO 8601 sale time; defaults to now" })
  @IsOptional()
  @IsISO8601()
  dateTime?: string;

  @ApiProperty({ description: "FBR PaymentMode: 1 cash, 2 card, 3 gift voucher, 4 loyalty card, 5 mixed, 6 cheque" })
  @IsInt()
  @IsIn([1, 2, 3, 4, 5, 6])
  paymentMode!: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @ApiProperty({ required: false, type: PosBuyerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosBuyerDto)
  buyer?: PosBuyerDto;

  @ApiProperty({ type: [PosSaleLineDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => PosSaleLineDto)
  lines!: PosSaleLineDto[];
}

export class PosReturnLineDto {
  @ApiProperty()
  @IsString()
  itemCode!: string;

  @ApiProperty()
  @IsNumberString()
  quantity!: string;
}

export class CreatePosReturnDto {
  @ApiProperty({ description: "The POS's unique id for this RETURN transaction (idempotency key)" })
  @IsString()
  @Length(1, 64)
  clientSaleId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  dateTime?: string;

  @ApiProperty({ type: [PosReturnLineDto], description: "Items/quantities being returned; priced as on the original sale" })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => PosReturnLineDto)
  lines!: PosReturnLineDto[];
}

// ── Terminal administration (ERP users) ───────────────────────────────

export class CreatePosTerminalDto {
  @ApiProperty()
  @IsString()
  @Length(1, 20)
  code!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ description: "POSID issued by FBR (IRIS → POS registration)" })
  @IsInt()
  @Min(1)
  fbrPosId!: number;

  @ApiProperty({ description: "Customer used for walk-in sales" })
  @IsUUID()
  walkInPartnerId!: string;

  @ApiProperty({ description: "Cash account the till's cash sales land in" })
  @IsUUID()
  cashAccountId!: string;

  @ApiProperty({ required: false, description: "Bank/clearing account for card sales (defaults to cash)" })
  @IsOptional()
  @IsUUID()
  cardAccountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

export class UpdatePosTerminalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  fbrPosId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  cardAccountId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
