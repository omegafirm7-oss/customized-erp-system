import { ApiProperty } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsString } from "class-validator";

export class UpdateClientModulesDto {
  @ApiProperty({ type: [String], example: ["purchase", "crm", "sales"] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledModules!: string[];
}
