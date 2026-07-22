import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions, SensitivePermission } from "../common/decorators/permissions.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { CompanyJoinRequestsService } from "../iam/company-join-requests.service";
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { CreateJoinRequestDto } from "../iam/dto/company-join-request.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("companies")
@ApiBearerAuth()
@Controller("companies")
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly companyJoinRequestsService: CompanyJoinRequestsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateCompanyDto, @CurrentUser() user: JwtPayload) {
    // Company creation itself has no company-scoped permission to check yet
    // (the caller doesn't belong to the company being created); any
    // authenticated user may create a company and becomes its Administrator.
    return this.companiesService.createCompany(dto, user.sub);
  }

  @Post("join-requests")
  async requestToJoin(@Body() dto: CreateJoinRequestDto, @CurrentUser() user: JwtPayload) {
    // Same rationale as company creation above: the requester isn't a
    // member of anything yet, so there's no company-scoped permission to
    // check — any authenticated user may request to join any company.
    return this.companyJoinRequestsService.create(user.sub, dto.companyCode, dto.message);
  }

  @Get("join-requests/mine")
  async myJoinRequests(@CurrentUser() user: JwtPayload) {
    return this.companyJoinRequestsService.listMineForUser(user.sub);
  }

  @Get("current")
  async getCurrent(@CurrentCompanyId() companyId: string) {
    return this.companiesService.getCompany(companyId);
  }

  @Patch("current")
  @Permissions(PERMISSIONS.COMPANY_MANAGE)
  async updateCurrent(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.updateCompany(companyId, user.sub, { ...dto });
  }

  @Get("current/fiscal-periods")
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async listFiscalPeriods(@CurrentCompanyId() companyId: string) {
    return this.companiesService.listFiscalPeriods(companyId);
  }

  @Post("current/fiscal-periods/:periodId/close")
  @Permissions(PERMISSIONS.PERIOD_CLOSE)
  @SensitivePermission()
  async closeFiscalPeriod(
    @CurrentCompanyId() companyId: string,
    @Param("periodId") periodId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companiesService.closeFiscalPeriod(companyId, periodId, user.sub);
  }
}
