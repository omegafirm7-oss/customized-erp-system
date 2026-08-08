import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ActivitiesService } from "./activities.service";
import { CreateActivityDto } from "./dto/create-activity.dto";
import { UpdateActivityDto } from "./dto/update-activity.dto";

@ApiTags("crm-activities")
@ApiBearerAuth()
@Controller("crm/activities")
@RequiresModule(MODULE_KEYS.CRM)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @Permissions(PERMISSIONS.CRM_ACTIVITY_MANAGE)
  async list(
    @CurrentCompanyId() companyId: string,
    @Query("leadId") leadId?: string,
    @Query("opportunityId") opportunityId?: string,
    @Query("businessPartnerId") businessPartnerId?: string,
  ) {
    return this.activitiesService.list(companyId, { leadId, opportunityId, businessPartnerId });
  }

  @Post()
  @Permissions(PERMISSIONS.CRM_ACTIVITY_MANAGE)
  async create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activitiesService.create(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.CRM_ACTIVITY_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(companyId, id, user.sub, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.CRM_ACTIVITY_MANAGE)
  async delete(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    await this.activitiesService.delete(companyId, id, user.sub);
    return { success: true };
  }
}
