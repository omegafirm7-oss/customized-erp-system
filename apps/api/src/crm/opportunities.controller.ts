import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { OpportunityStage } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { OpportunitiesService } from "./opportunities.service";
import { CreateOpportunityDto } from "./dto/create-opportunity.dto";
import { LoseOpportunityDto, UpdateOpportunityDto } from "./dto/update-opportunity.dto";

@ApiTags("crm-opportunities")
@ApiBearerAuth()
@Controller("crm/opportunities")
@RequiresModule(MODULE_KEYS.CRM)
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Get()
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("stage") stage?: OpportunityStage) {
    return this.opportunitiesService.list(companyId, stage);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.opportunitiesService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
  async create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.opportunitiesService.create(companyId, user.sub, dto);
  }

  @Post("from-lead/:leadId")
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE, PERMISSIONS.CRM_LEAD_MANAGE)
  async convertLead(
    @CurrentCompanyId() companyId: string,
    @Param("leadId") leadId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.opportunitiesService.convertLead(companyId, leadId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunitiesService.update(companyId, id, user.sub, dto);
  }

  @Post(":id/win")
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
  async win(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.win(companyId, id, user.sub);
  }

  @Post(":id/lose")
  @Permissions(PERMISSIONS.CRM_OPPORTUNITY_MANAGE)
  async lose(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: LoseOpportunityDto,
  ) {
    return this.opportunitiesService.lose(companyId, id, user.sub, dto);
  }
}
