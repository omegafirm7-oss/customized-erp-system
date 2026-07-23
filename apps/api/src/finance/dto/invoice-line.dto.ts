import { ApiProperty } from "@nestjs/swagger";
import { VatCategory } from "@prisma/client";
import { IsEnum, IsIn, IsNumberString, IsOptional, IsString, IsUUID } from "class-validator";

export class InvoiceLineDto {
  @ApiProperty({ required: false, description: "Optional item reference — fills description/VAT/account defaults" })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  uomId?: string;

  @ApiProperty()
  @IsNumberString()
  quantity!: string;

  @ApiProperty()
  @IsNumberString()
  unitPrice!: string;

  @ApiProperty({ required: false, default: "0" })
  @IsOptional()
  @IsNumberString()
  discountAmount?: string;

  @ApiProperty({ enum: VatCategory, required: false, description: "Defaults to the item's category, else STANDARD_15" })
  @IsOptional()
  @IsEnum(VatCategory)
  vatCategory?: VatCategory;

  @ApiProperty({
    enum: ["EXCLUSIVE", "INCLUSIVE"],
    required: false,
    description: "Whether the line amount (qty*unitPrice-discount) is tax-exclusive (default) or tax-inclusive",
  })
  @IsOptional()
  @IsIn(["EXCLUSIVE", "INCLUSIVE"])
  taxMode?: "EXCLUSIVE" | "INCLUSIVE";

  @ApiProperty({ required: false, description: "Revenue (AR) / expense (AP) account override; defaults from the item" })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({ required: false, description: "Warehouse for inventory items; defaults to the company default warehouse" })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ required: false, description: "Project for job costing — stamps the project's cost center on GL legs" })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ required: false, description: "WBS task (must belong to the line's project)" })
  @IsOptional()
  @IsUUID()
  wbsTaskId?: string;

  @ApiProperty({
    required: false,
    description: "Explicit cost-center dimension for the GL revenue leg (SALES only); mutually exclusive with projectId",
  })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
