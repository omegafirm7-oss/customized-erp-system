import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

export class PaymentAllocationDto {
  @ApiProperty({ description: "Sales invoice id for incoming payments, purchase invoice id for outgoing" })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty()
  @IsNumberString()
  amount!: string;
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  businessPartnerId!: string;

  @ApiProperty()
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ description: "A BANK or CASH control account of this company" })
  @IsUUID()
  bankCashAccountId!: string;

  @ApiProperty()
  @IsNumberString()
  amount!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [PaymentAllocationDto], description: "May be empty — remainder is held on account" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations!: PaymentAllocationDto[];
}
