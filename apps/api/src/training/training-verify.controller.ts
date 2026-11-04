import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from "@nestjs/common";
import { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { TrainingService } from "./training.service";

/**
 * Public certificate verification — the target of the QR code printed on
 * each certificate. No login. Looked up by the certificate's random
 * verifyToken (never the sequential certificate number, which would let
 * anyone enumerate every trainee), and only a minimal, ID-masked view is
 * returned.
 */
@ApiTags("training-verify")
@Controller("public/training/verify")
@Public()
export class TrainingVerifyController {
  constructor(private readonly training: TrainingService) {}

  @Get(":token")
  verify(@Param("token", ParseUUIDPipe) token: string, @Res({ passthrough: true }) res: Response) {
    res.set({ "Cache-Control": "no-store" });
    return this.training.verify(token);
  }

  @Get(":token/photo")
  async photo(@Param("token", ParseUUIDPipe) token: string, @Res({ passthrough: true }) res: Response) {
    const photo = await this.training.verifyPhoto(token);
    res.set({ "Content-Type": photo.mimeType, "Cache-Control": "no-store" });
    return new StreamableFile(photo.data);
  }
}
