import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JournalEntryStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { GlPostingService } from "./gl-posting.service";
import { CreateJournalEntryDto } from "./dto/create-journal-entry.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("general-ledger")
@ApiBearerAuth()
@Controller("gl/journal-entries")
export class GlController {
  constructor(private readonly glPostingService: GlPostingService) {}

  @Get()
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: JournalEntryStatus) {
    return this.glPostingService.listEntries(companyId, status);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.glPostingService.getEntry(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.JOURNAL_CREATE)
  async createDraft(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.glPostingService.createDraft(companyId, user.sub, dto);
  }

  @Post(":id/post")
  @Permissions(PERMISSIONS.JOURNAL_POST)
  async post(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.glPostingService.postEntry(companyId, id, user.sub, allowSoftClosedOverride);
  }

  @Post(":id/reverse")
  @Permissions(PERMISSIONS.JOURNAL_REVERSE)
  async reverse(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.glPostingService.reverseEntry(companyId, id, user.sub);
  }
}
