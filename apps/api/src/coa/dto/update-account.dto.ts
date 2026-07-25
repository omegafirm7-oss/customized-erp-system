import { ApiProperty } from "@nestjs/swagger";
import { ProjectCostCategory } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateAccountDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty({
    required: false,
    enum: ProjectCostCategory,
    description: "Project Intelligence dashboard bucket; omit/null to clear (uncategorized → shown as Other)",
  })
  @IsOptional()
  @IsEnum(ProjectCostCategory)
  costCategory?: ProjectCostCategory | null;
}
