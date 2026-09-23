import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class ResearchLeadsDto {
  @ApiProperty({ example: "Safety Training & TUV Cards (TVTC-accredited)" })
  @IsString()
  @MaxLength(200)
  service!: string;

  @ApiProperty({ example: "SME contractors (Grade 3-5)" })
  @IsString()
  @MaxLength(200)
  targetType!: string;

  @ApiProperty({ example: "Jubail" })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  extraCriteria?: string;

  @ApiProperty({ required: false, type: [String], description: "Companies already shown this session" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCompanies?: string[];
}
