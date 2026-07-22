import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class CreateJoinRequestDto {
  @ApiProperty({ description: "The company code given by the requester's employer" })
  @IsString()
  companyCode!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}

export class ApproveJoinRequestDto {
  @ApiProperty({ description: "Role to grant the requester in this company" })
  @IsString()
  roleId!: string;
}
