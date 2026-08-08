import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../common/guards/platform-admin.guard";
import { PlatformService } from "./platform.service";
import { UpdateClientModulesDto } from "./dto/update-client-modules.dto";

// JwtAuthGuard is registered globally in AppModule. PlatformAdminGuard is
// applied locally (not via @Permissions()) since this dashboard is
// cross-tenant by design and must never be reachable through the
// company-scoped permission system.
@ApiTags("platform")
@ApiBearerAuth()
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get("summary")
  async getSummary() {
    return this.platformService.getSummary();
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
