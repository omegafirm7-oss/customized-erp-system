import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { Response } from "express";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { TemplateSettingsService } from "./template-settings.service";
import { UpdateTemplateSettingsDto } from "./dto/template-settings.dtos";

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings/templates")
export class TemplateSettingsController {
  constructor(private readonly templateSettingsService: TemplateSettingsService) {}

  @Get()
  @Permissions(PERMISSIONS.SETTINGS_TEMPLATES_MANAGE)
  async get(@CurrentCompanyId() companyId: string) {
    return this.templateSettingsService.get(companyId);
  }

  @Patch()
  @Permissions(PERMISSIONS.SETTINGS_TEMPLATES_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateTemplateSettingsDto,
  ) {
    return this.templateSettingsService.update(companyId, user.sub, dto);
  }

  @Post("logo")
  @Permissions(PERMISSIONS.SETTINGS_TEMPLATES_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.templateSettingsService.setLogo(companyId, user.sub, file.buffer, file.mimetype);
  }

  @Get("logo")
  @Permissions(PERMISSIONS.SETTINGS_TEMPLATES_MANAGE)
  async getLogo(@CurrentCompanyId() companyId: string, @Res({ passthrough: true }) res: Response) {
    const logo = await this.templateSettingsService.getLogo(companyId);
    res.set({ "Content-Type": logo.mimeType });
    return new StreamableFile(logo.data);
  }

  @Delete("logo")
  @Permissions(PERMISSIONS.SETTINGS_TEMPLATES_MANAGE)
  async removeLogo(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload) {
    return this.templateSettingsService.removeLogo(companyId, user.sub);
  }
}
