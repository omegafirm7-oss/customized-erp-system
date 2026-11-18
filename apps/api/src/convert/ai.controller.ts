import { BadRequestException, Body, Controller, Get, Post, Req, ServiceUnavailableException, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Request } from "express";
import { memoryStorage } from "multer";
import { Public } from "../common/decorators/public.decorator";
import { AiLimiter } from "./ai-limiter";
import { AiService, SUPPORTED_LANGUAGES, SummaryLength } from "./ai.service";

const MB = 1024 * 1024;
/** Text arrives as an ordinary form field (JSON bodies are capped far lower), so the field limit is raised for these routes only. */
const textForm = () => FileInterceptor("none", { storage: memoryStorage(), limits: { fieldSize: 2 * MB, files: 0, fields: 6 } });

class SummarizeDto {
  @IsString()
  @MaxLength(1_000_000)
  text!: string;

  @IsOptional()
  @IsIn(["short", "medium", "detailed"])
  length?: SummaryLength;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}

class TranslateDto {
  @IsString()
  @MaxLength(1_000_000)
  text!: string;

  @IsString()
  @MaxLength(40)
  target!: string;
}

const MAX_SUMMARY_CHARS = 150_000;
const MAX_TRANSLATE_CHARS = 12_000;

/** Public AI tools (summarise and translate a PDF's text). Capped per visitor, per day, and by concurrency. */
@ApiTags("public-ai")
@Controller("public/ai")
@Public()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly limiter: AiLimiter,
  ) {}

  private visitor(req: Request) {
    return String(req.headers["x-real-ip"] ?? req.ip ?? "unknown");
  }

  @Get("status")
  status() {
    return { available: this.ai.available };
  }

  /** Runs a model call inside the limits, handing the allowance back if it never reached the model. */
  private async guarded<T>(req: Request, chars: number, job: () => Promise<T>): Promise<T> {
    if (!this.ai.available) throw new ServiceUnavailableException("The AI tools are not switched on yet on this server.");
    const ip = this.visitor(req);
    this.limiter.reserve(ip, chars);
    try {
      return await this.limiter.run(job);
    } catch (err) {
      this.limiter.refund(ip, chars);
      throw err;
    }
  }

  @Post("summarize")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(textForm())
  async summarize(@Req() req: Request, @Body() dto: SummarizeDto) {
    const text = dto.text.trim();
    if (text.length < 50) throw new BadRequestException("There isn't enough text to summarise.");
    const clipped = text.slice(0, MAX_SUMMARY_CHARS);
    const summary = await this.guarded(req, clipped.length, () => this.ai.summarize(clipped, dto.length ?? "medium", dto.language ?? "same"));
    return { summary, truncated: text.length > clipped.length };
  }

  @Post("translate")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(textForm())
  async translate(@Req() req: Request, @Body() dto: TranslateDto) {
    if (!SUPPORTED_LANGUAGES.has(dto.target)) throw new BadRequestException("That language is not supported.");
    const text = dto.text.trim();
    if (!text) throw new BadRequestException("There is no text to translate.");
    if (text.length > MAX_TRANSLATE_CHARS) throw new BadRequestException("That part is too long. Send it in smaller pieces.");
    const translation = await this.guarded(req, text.length, () => this.ai.translate(text, dto.target));
    return { translation };
  }
}
