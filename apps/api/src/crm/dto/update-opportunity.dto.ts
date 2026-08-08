import { ApiProperty } from "@nestjs/swagger";
import { OpportunityStage } from "@prisma/client";
import { IsDateString, IsEnum, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class UpdateOpportunityDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;

  @ApiProperty({ enum: OpportunityStage, required: false })
  @IsOptional()
  @IsEnum(OpportunityStage)
  stage?: OpportunityStage;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  estimatedValue?: string;

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}

export class LoseOpportunityDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lostReason?: string;
}
