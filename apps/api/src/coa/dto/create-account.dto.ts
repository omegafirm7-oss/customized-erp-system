import { ApiProperty } from "@nestjs/swagger";
import { ControlAccountType, NormalBalance } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateAccountDto {
  @ApiProperty()
  @IsString()
  code!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty()
  @IsString()
  accountSubClassCode!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentAccountId?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiProperty({ enum: NormalBalance })
  @IsEnum(NormalBalance)
  normalBalance!: NormalBalance;

  @ApiProperty({ enum: ControlAccountType, required: false })
  @IsOptional()
  @IsEnum(ControlAccountType)
  controlAccountType?: ControlAccountType;
}
