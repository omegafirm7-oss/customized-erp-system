import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

class OutreachBaseDto {
  @ApiProperty()
  @IsUUID()
  leadId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;

  @ApiProperty({ required: false, description: "Set when sending a scheduled follow-up — completes it in place" })
  @IsOptional()
  @IsUUID()
  followUpActivityId?: string;

  @ApiProperty({ required: false, description: "Schedule follow-ups per the agent settings cadence" })
  @IsOptional()
  @IsBoolean()
  scheduleFollowUps?: boolean;
}

export class SendEmailDto extends OutreachBaseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  subject!: string;

  @ApiProperty({ required: false, description: "Defaults to the lead's email" })
  @IsOptional()
  @IsEmail()
  to?: string;
}

export class LogWhatsAppDto extends OutreachBaseDto {
  @ApiProperty({ required: false, description: "Defaults to the lead's phone" })
  @IsOptional()
  @IsString()
  to?: string;
}
