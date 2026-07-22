import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ description: "New temporary password — share it with the user out of band" })
  @IsString()
  @MinLength(10)
  newPassword!: string;
}
