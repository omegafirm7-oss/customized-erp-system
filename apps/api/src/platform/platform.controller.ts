import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../common/guards/platform-admin.guard";
import { PlatformService } from "./platform.service";
import { UpdateClientModulesDto } from "./dto/update-client-modules.dto";
import { CloudUsageService } from "./cloud-usage/cloud-usage.service";

// JwtAuthGuard is registered globally in AppModule. PlatformAdminGuard is
// applied locally (not via @Permissions()) since this dashboard is
// cross-tenant by design and must never be reachable through the
// company-scoped permission system.
@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly cloudUsageService: CloudUsageService,
  ) {}

  @Get("summary")
  async getSummary() {
    return this.platformService.getSummary();
  }

  /**
   * OCI cost + Always-Free-tier usage for the infrastructure this app runs
   * on (not per-tenant app data — that's `summary`/`clients` above). Cached
   * ~30min server-side; `?force=true` bypasses the cache for a manual
   * refresh from the UI.
   */
  @Get("cloud-usage")
  async getCloudUsage(@Query("force") force?: string) {
    return this.cloudUsageService.getSnapshot(force === "true");
  }

  @Get("clients")
  async listClients() {
    return this.platformService.listClients();
  }

  @Patch("clients/:id/modules")
  async updateClientModules(@Param("id") id: string, @Body() dto: UpdateClientModulesDto) {
    return this.platformService.updateClientModules(id, dto.enabledModules);
  }
}
