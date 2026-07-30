import { ApiProperty } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

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

export class UpdateCompanyUserStatusDto {
  @ApiProperty({ enum: ["ACTIVE", "SUSPENDED"] })
  @IsIn(["ACTIVE", "SUSPENDED"])
  status!: "ACTIVE" | "SUSPENDED";
}

export class CreateCompanyUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({ description: "Only used if this email doesn't already have an account" })
  @IsString()
  @MinLength(10)
  password!: string;

  @ApiProperty()
  @IsString()
  roleId!: string;
}
