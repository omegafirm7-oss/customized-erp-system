import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuditAction } from "@prisma/client";
import { PlatformAdminGuard } from "../common/guards/platform-admin.guard";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { AuditService } from "./audit.service";

// Restricted to the platform-admin identity (omegafirm7@gmail.com), not the
// per-company permission system — even a company's own Administrator role
// can't see this. Deliberate per explicit product decision: activity logs
// are a SaaS-provider-only visibility tool, not a customer-facing feature.
@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
@UseGuards(PlatformAdminGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get("activity-log")
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
