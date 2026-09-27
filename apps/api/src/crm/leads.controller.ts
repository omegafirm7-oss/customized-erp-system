import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { LeadStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered
// globally in AppModule.
@ApiTags("crm-leads")
@ApiBearerAuth()
@Controller("crm/leads")
@RequiresModule(MODULE_KEYS.CRM)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: LeadStatus) {
    return this.leadsService.list(companyId, status);
  }

  // Registered before :id so "dashboard" isn't read as a lead id.
  @Get("dashboard")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  async dashboard(@CurrentCompanyId() companyId: string) {
    return this.leadsService.dashboard(companyId);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.leadsService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(companyId, id, user.sub, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  async delete(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    await this.leadsService.delete(companyId, id, user.sub);
    return { success: true };
  }
}
