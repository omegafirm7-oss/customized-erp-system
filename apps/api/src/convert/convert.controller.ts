import { BadRequestException, Body, Controller, Post, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Request, Response } from "express";
import { memoryStorage } from "multer";
import { Public } from "../common/decorators/public.decorator";
import { ConvertLimiter } from "./convert-limiter";
import { ConvertService } from "./convert.service";
import { OfficeKind } from "./upload-check";

class HtmlConvertDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  html?: string;

  @IsOptional()
  @IsIn(["A4", "Letter"])
  pageSize?: "A4" | "Letter";

  @IsOptional()
  @IsIn(["true", "false"])
  landscape?: string;

  @IsOptional()
  @IsIn(["0", "10", "20"])
  margin?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  background?: string;
}

const MB = 1024 * 1024;

/**
 * Public converters for the free PDF toolkit: Word/PowerPoint (LibreOffice) and
 * HTML or web pages (headless Chromium). No login, so every call is rate
 * limited per visitor and queued, and nothing is kept after the response.
 */
@ApiTags("public-convert")
@Controller("public/convert")
@Public()
export class ConvertController {
  constructor(
    private readonly convert: ConvertService,
    private readonly limiter: ConvertLimiter,
  ) {}

  private visitor(req: Request) {
    return String(req.headers["x-real-ip"] ?? req.ip ?? "unknown");
  }

  private send(res: Response, pdf: Buffer, filename: string) {
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(pdf);
  }

  private async office(kind: OfficeKind, req: Request, res: Response, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file was uploaded.");
    this.limiter.checkRate(this.visitor(req));
    const pdf = await this.limiter.run(() => this.convert.officeToPdf(file, kind));
    return this.send(res, pdf, file.originalname.replace(/\.[^.]+$/, "") + ".pdf");
  }

  @Post("word")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 20 * MB, files: 1 } }))
  word(@Req() req: Request, @Res({ passthrough: true }) res: Response, @UploadedFile() file?: Express.Multer.File) {
    return this.office("word", req, res, file);
  }

  @Post("powerpoint")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 25 * MB, files: 1 } }))
  powerpoint(@Req() req: Request, @Res({ passthrough: true }) res: Response, @UploadedFile() file?: Express.Multer.File) {
    return this.office("powerpoint", req, res, file);
  }

  @Post("html")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * MB, files: 1 } }))
  async html(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: HtmlConvertDto, @UploadedFile() file?: Express.Multer.File) {
    const url = dto.url?.trim();
    const html = file ? file.buffer.toString("utf8") : dto.html;
    const sources = [url, html?.trim()].filter(Boolean).length;
    if (sources !== 1) throw new BadRequestException("Give either a web address, an HTML file, or pasted HTML.");
    this.limiter.checkRate(this.visitor(req));
    const pdf = await this.limiter.run(() =>
      this.convert.htmlToPdf({
        url,
        html: url ? undefined : html,
        pageSize: dto.pageSize ?? "A4",
        landscape: dto.landscape === "true",
        marginMm: Number(dto.margin ?? "10"),
        background: dto.background !== "false",
      }),
    );
    let name = "page.pdf";
    if (file) name = file.originalname.replace(/\.[^.]+$/, "") + ".pdf";
    else if (url) {
      try {
        name = new URL(url).hostname.replace(/^www\./, "") + ".pdf";
      } catch {
        /* keep the default */
      }
    }
    return this.send(res, pdf, name);
  }
}
