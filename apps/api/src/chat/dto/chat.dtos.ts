import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export class CreateChannelDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  /** Only used for private channels: who is in it besides the creator. */
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("all", { each: true })
  memberUserIds?: string[];
}

export class RenameChannelDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  name!: string;
}

export class InvitePersonDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  /** Needed only when this email has no Universa account yet. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}

export class DirectChannelDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("all", { each: true })
  userIds!: string[];
}

export class PostMessageDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
}
