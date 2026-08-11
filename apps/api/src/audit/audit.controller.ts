import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuditAction } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { AuditService } from "./audit.service";

@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get("activity-log")
  @Permissions(PERMISSIONS.SETTINGS_ACTIVITY_LOG_VIEW)
  async listActivityLog(
    @CurrentCompanyId() companyId: string,
    @Query("userId") userId?: string,
    @Query("action") action?: string,
    @Query("entityName") entityName?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    if (action && !(Object.values(AuditAction) as string[]).includes(action)) {
      throw new BadRequestException(`Unknown action "${action}"`);
    }
    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.min(200, Math.max(1, Number(pageSize) || 50));
    return this.auditService.list(companyId, {
      userId: userId || undefined,
      action: action ? (action as AuditAction) : undefined,
      entityName: entityName || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  }
}
