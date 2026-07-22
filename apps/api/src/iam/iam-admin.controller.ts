import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { IamService } from "./iam.service";
import { RolesService } from "./roles.service";
import { UsersService } from "./users.service";
import { CompanyJoinRequestsService } from "./company-join-requests.service";
import { ResetPasswordDto } from "./dto/iam.dtos";
import { ApproveJoinRequestDto } from "./dto/company-join-request.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
// Separate from IamController ("iam/me") since these routes are company-
// admin scoped, not "the current user's own profile".
@ApiTags("iam")
@ApiBearerAuth()
@Controller("iam")
export class IamAdminController {
  constructor(
    private readonly iamService: IamService,
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly companyJoinRequestsService: CompanyJoinRequestsService,
  ) {}

  @Get("company-users")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async listCompanyUsers(@CurrentCompanyId() companyId: string) {
    return this.iamService.listCompanyUsers(companyId);
  }

  @Get("roles")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async listRoles(@CurrentCompanyId() companyId: string) {
    return this.rolesService.listRoles(companyId);
  }

  @Patch("users/:id/reset-password")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async resetPassword(
    @CurrentCompanyId() companyId: string,
    @Param("id") userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    const isMember = await this.iamService.isCompanyMember(userId, companyId);
    if (!isMember) {
      throw new ForbiddenException("User does not belong to this company");
    }
    return this.usersService.adminResetPassword(userId, dto.newPassword);
  }

  @Get("join-requests")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async listJoinRequests(@CurrentCompanyId() companyId: string) {
    return this.companyJoinRequestsService.listPendingForCompany(companyId);
  }

  @Post("join-requests/:id/approve")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async approveJoinRequest(
    @CurrentCompanyId() companyId: string,
    @Param("id") requestId: string,
    @Body() dto: ApproveJoinRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companyJoinRequestsService.approve(companyId, requestId, dto.roleId, user.sub);
  }

  @Post("join-requests/:id/reject")
  @Permissions(PERMISSIONS.IAM_USER_MANAGE)
  async rejectJoinRequest(
    @CurrentCompanyId() companyId: string,
    @Param("id") requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companyJoinRequestsService.reject(companyId, requestId, user.sub);
  }
}
