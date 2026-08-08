import { ApiProperty } from "@nestjs/swagger";
import { CrmActivityType } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateActivityDto {
  @ApiProperty({ enum: CrmActivityType })
  @IsEnum(CrmActivityType)
  type!: CrmActivityType;

  @ApiProperty()
  @IsString()
  subject!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false, description: "Exactly one of leadId/opportunityId/businessPartnerId is required" })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  businessPartnerId?: string;
}
