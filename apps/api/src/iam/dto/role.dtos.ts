import { ApiProperty } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ type: [String], description: "Permission keys this role grants (e.g. hr.employee.view)" })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class UpdateCompanyUserRoleDto {
  @ApiProperty()
  @IsString()
  roleId!: string;
}
