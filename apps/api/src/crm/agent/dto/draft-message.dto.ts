import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class DraftMessageDto {
  @ApiProperty()
  @IsUUID()
  leadId!: string;

  @ApiProperty({ enum: ["WHATSAPP", "EMAIL"] })
  @IsIn(["WHATSAPP", "EMAIL"])
  channel!: "WHATSAPP" | "EMAIL";

  @ApiProperty({ required: false, enum: ["INTRO", "FOLLOW_UP"], description: "Defaults to FOLLOW_UP once anything was sent" })
  @IsOptional()
  @IsIn(["INTRO", "FOLLOW_UP"])
  purpose?: "INTRO" | "FOLLOW_UP";

  @ApiProperty({ required: false, enum: ["en", "ar", "both"] })
  @IsOptional()
  @IsIn(["en", "ar", "both"])
  language?: "en" | "ar" | "both";

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  extraInstructions?: string;
}
