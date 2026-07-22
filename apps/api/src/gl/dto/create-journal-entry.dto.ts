import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";

export class JournalEntryLineInputDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ description: "Transaction-currency debit amount, '0' if this line is a credit" })
  @IsNumberString()
  debit!: string;

  @ApiProperty({ description: "Transaction-currency credit amount, '0' if this line is a debit" })
  @IsNumberString()
  credit!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({ required: false, description: "Convenience: resolves to the project's cost center" })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ required: false, description: "WBS task (must belong to the line's project)" })
  @IsOptional()
  @IsUUID()
  wbsTaskId?: string;
}

export class CreateJournalEntryDto {
  @ApiProperty()
  @IsDateString()
  postingDate!: string;

  @ApiProperty()
  @IsDateString()
  documentDate!: string;

  @ApiProperty({ description: "ISO 4217, defaults to company base currency" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [JournalEntryLineInputDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineInputDto)
  lines!: JournalEntryLineInputDto[];
}
