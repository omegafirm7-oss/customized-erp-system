import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../../auth/types/jwt-payload.type";
import { OutreachService } from "./outreach.service";
import { UpdateAgentSettingsDto } from "./dto/update-agent-settings.dto";
import { ResearchLeadsDto } from "./dto/research-leads.dto";
import { ImportLeadsDto } from "./dto/import-leads.dto";
import { DraftMessageDto } from "./dto/draft-message.dto";
import { LogWhatsAppDto, SendEmailDto } from "./dto/send-outreach.dto";

// CRM sales agent: AI lead research, AI message drafting, and WhatsApp /
// email outreach with follow-ups. Rides on the existing lead permissions —
// anyone who can manage leads can research, draft and contact them.
@ApiTags("crm-agent")
@ApiBearerAuth()
@Controller("crm/agent")
@RequiresModule(MODULE_KEYS.CRM)
export class SalesAgentController {
  constructor(private readonly outreach: OutreachService) {}

  @Get("status")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  status() {
    return this.outreach.status();
  }

  @Get("settings")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  getSettings(@CurrentCompanyId() companyId: string) {
    return this.outreach.getSettings(companyId);
  }

  @Put("settings")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  updateSettings(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateAgentSettingsDto) {
    return this.outreach.updateSettings(companyId, user.sub, dto);
  }

  @Post("research")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  research(@CurrentCompanyId() companyId: string, @Body() dto: ResearchLeadsDto) {
    return this.outreach.research(companyId, dto);
  }

  @Post("import")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  importLeads(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: ImportLeadsDto) {
    return this.outreach.importLeads(companyId, user.sub, dto);
  }

  @Post("draft")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  draft(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: DraftMessageDto) {
    return this.outreach.draft(companyId, user.sub, dto);
  }

  @Post("send-email")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  sendEmail(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: SendEmailDto) {
    return this.outreach.sendEmail(companyId, user.sub, dto);
  }

  @Post("log-whatsapp")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  logWhatsApp(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: LogWhatsAppDto) {
    return this.outreach.logWhatsApp(companyId, user.sub, dto);
  }

  @Get("follow-ups")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  followUps(@CurrentCompanyId() companyId: string) {
    return this.outreach.listFollowUps(companyId);
  }

  @Get("assets")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  listAssets(@CurrentCompanyId() companyId: string) {
    return this.outreach.listAssets(companyId);
  }

  @Post("assets")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadAsset(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.outreach.uploadAsset(companyId, user.sub, file);
  }

  @Get("assets/:id/file")
  @Permissions(PERMISSIONS.CRM_LEAD_VIEW)
  async getAssetFile(
    @CurrentCompanyId() companyId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asset = await this.outreach.getAssetFile(companyId, id);
    res.set({ "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600" });
    return new StreamableFile(Buffer.from(asset.data));
  }

  @Delete("assets/:id")
  @Permissions(PERMISSIONS.CRM_LEAD_MANAGE)
  async deleteAsset(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.outreach.deleteAsset(companyId, user.sub, id);
    return { success: true };
  }
}
