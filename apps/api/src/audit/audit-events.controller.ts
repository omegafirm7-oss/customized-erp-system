import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Request } from "express";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { AuditService } from "./audit.service";

class TimesheetDownloadDto {
  @IsString()
  @MaxLength(64)
  employeeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  periodId?: string;

  @IsIn(["DOWNLOAD", "WHATSAPP"])
  channel!: "DOWNLOAD" | "WHATSAPP";
}

/**
 * Events the browser reports because they happen entirely on the user's computer (the timesheet PDF is built
 * there), so the server wouldn't otherwise know. Open to anyone who can view timesheets; the Activity Log that
 * shows these entries stays platform-admin only.
 */
@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit/events")
export class AuditEventsController {
  constructor(private readonly auditService: AuditService) {}

  @Post("timesheet-download")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async timesheetDownload(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Body() dto: TimesheetDownloadDto,
  ) {
    await this.auditService.logTimesheetDownload(companyId, user.sub, dto, {
      ipAddress: String(req.headers["x-real-ip"] ?? req.ip ?? ""),
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
    });
    return { logged: true };
  }
}
