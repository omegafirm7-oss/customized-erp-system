import { IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class SwitchCompanyDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;
}
