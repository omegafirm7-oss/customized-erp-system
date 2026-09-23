import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class ResearchedLeadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  companyName!: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) activity?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) location?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) website?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) whyTheyNeedUs?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) howToReach?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(10) confidence?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ImportLeadsDto {
  @ApiProperty({ type: [ResearchedLeadDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResearchedLeadDto)
  leads!: ResearchedLeadDto[];

  @ApiProperty({ required: false, description: "City searched — used when a lead has no location" })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  businessLines?: string[];
}
