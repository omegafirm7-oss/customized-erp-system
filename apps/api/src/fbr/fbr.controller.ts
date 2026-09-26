import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { FbrSettingsService } from "./fbr-settings.service";
import { FbrSubmissionService } from "./fbr-submission.service";
import { ListFbrSubmissionsQuery, UpdateFbrSettingsDto } from "./dto/fbr.dto";
import { FBR_BUSINESS_ACTIVITIES, FBR_SCENARIO_DESCRIPTIONS, FBR_SECTORS, PK_PROVINCES } from "./fbr-constants";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are global.
@ApiTags("fbr")
@ApiBearerAuth()
@RequiresModule(MODULE_KEYS.FBR)
@Controller("fbr")
export class FbrController {
  constructor(
    private readonly settingsService: FbrSettingsService,
    private readonly submissionService: FbrSubmissionService,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────────

  @Get("settings")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  async getSettings(@CurrentCompanyId() companyId: string) {
    return this.settingsService.get(companyId);
  }

  @Put("settings")
  @Permissions(PERMISSIONS.FBR_SETTINGS_MANAGE)
  async updateSettings(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateFbrSettingsDto,
  ) {
    return this.settingsService.update(companyId, user.sub, dto);
  }

  @Post("settings/test-connection")
  @Permissions(PERMISSIONS.FBR_SETTINGS_MANAGE)
  async testConnection(@CurrentCompanyId() companyId: string) {
    return this.settingsService.testConnection(companyId);
  }

  /** Static Pakistan reference lists for the UI dropdowns. */
  @Get("reference")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  reference() {
    return {
      provinces: PK_PROVINCES,
      businessActivities: FBR_BUSINESS_ACTIVITIES,
      sectors: FBR_SECTORS,
      scenarios: FBR_SCENARIO_DESCRIPTIONS,
    };
  }

  @Post("partners/:id/check-registration")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_RETRY)
  async checkPartnerRegistration(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.settingsService.checkPartnerRegistration(companyId, id);
  }

  // ── Submissions ──────────────────────────────────────────────────────

  @Get("submissions")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query() query: ListFbrSubmissionsQuery) {
    return this.submissionService.list(companyId, query);
  }

  @Get("submissions/summary")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  async summary(@CurrentCompanyId() companyId: string) {
    return this.submissionService.summary(companyId);
  }

  @Get("submissions/:id")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.submissionService.get(companyId, id);
  }

  @Post("submissions/:id/retry")
  @Permissions(PERMISSIONS.FBR_SUBMISSION_RETRY)
  async retry(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.submissionService.submit(companyId, id, { userId: user.sub, rebuild: true });
  }
}
