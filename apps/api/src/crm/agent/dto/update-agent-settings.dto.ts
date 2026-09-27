import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateAgentSettingsDto {
  @ApiProperty({ required: false, description: "Company description the AI pitches from — the only facts it may state" })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  companyProfile?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  emailSignature?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  replyToEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiProperty({ required: false, enum: ["en", "ar", "both"] })
  @IsOptional()
  @IsIn(["en", "ar", "both"])
  defaultLanguage?: string;

  @ApiProperty({ required: false, description: "Comma-separated day offsets, e.g. 3,7" })
  @IsOptional()
  @IsString()
  followUpDays?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  autoSendEmailFollowUps?: boolean;

  @ApiProperty({ required: false, description: "Pre-filled email subject when clicking Message" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  defaultEmailSubject?: string;

  @ApiProperty({ required: false, description: "Pre-filled message; {name} and {company} are replaced per lead" })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  defaultMessage?: string;
}
