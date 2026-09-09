import { Controller, Post, Get, Param, UseInterceptors, UploadedFile, BadRequestException, Res, StreamableFile } from "@nestjs/common";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PhotoUploadService } from "./photo-upload.service";

@ApiTags("photo-upload")
@Controller("photo-upload-sessions")
export class PhotoUploadController {
  constructor(private readonly photoUploadService: PhotoUploadService) {}

  @Post()
  async createSession(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload) {
    return this.photoUploadService.createSession(companyId, user.sub);
  }

  @Public()
  @Get(":token/status")
  async getStatus(@Param("token") token: string) {
    return this.photoUploadService.getStatus(token);
  }

  @Public()
  @Post(":token/upload")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadPhoto(@Param("token") token: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No photo uploaded");
    }
    return this.photoUploadService.uploadPhoto(token, file);
  }

  @Get(":token/file")
  async getFile(@CurrentCompanyId() companyId: string, @Param("token") token: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.photoUploadService.collectResult(companyId, token);
    res.set({ "Content-Type": result.mimeType, "Content-Disposition": `inline; filename="${result.filename}"` });
    return new StreamableFile(result.data);
  }
}
