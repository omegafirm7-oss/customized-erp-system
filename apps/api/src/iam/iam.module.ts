import { Module } from "@nestjs/common";
import { IamService } from "./iam.service";
import { RolesService } from "./roles.service";
import { UsersService } from "./users.service";
import { CompanyJoinRequestsService } from "./company-join-requests.service";
import { IamController } from "./iam.controller";
import { IamAdminController } from "./iam-admin.controller";

@Module({
  controllers: [IamController, IamAdminController],
  providers: [IamService, RolesService, UsersService, CompanyJoinRequestsService],
  exports: [IamService, RolesService, UsersService, CompanyJoinRequestsService],
})
export class IamModule {}
