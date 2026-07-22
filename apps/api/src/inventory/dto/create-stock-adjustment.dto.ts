import { ApiProperty } from "@nestjs/swagger";
import { StockAdjustmentDirection } from "@prisma/client";
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
  MinLength,
  ValidateNested,
} from "class-validator";

export class StockAdjustmentLineDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty()
  @IsNumberString()
  quantity!: string;

  @ApiProperty({ required: false, description: "Required for IN adjustments (functional currency)" })
  @IsOptional()
  @IsNumberString()
  unitCost?: string;
}

export class CreateStockAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: StockAdjustmentDirection })
  @IsEnum(StockAdjustmentDirection)
  direction!: StockAdjustmentDirection;

  @ApiProperty()
  @IsDateString()
  postingDate!: string;

  @ApiProperty({ description: "Mandatory audit reason" })
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiProperty({ type: [StockAdjustmentLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines!: StockAdjustmentLineDto[];
}
