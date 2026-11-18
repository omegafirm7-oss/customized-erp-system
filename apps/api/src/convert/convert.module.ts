import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiLimiter } from "./ai-limiter";
import { AiService } from "./ai.service";
import { ConvertController } from "./convert.controller";
import { ConvertLimiter } from "./convert-limiter";
import { ConvertService } from "./convert.service";

@Module({
  controllers: [ConvertController, AiController],
  providers: [ConvertService, ConvertLimiter, AiService, AiLimiter],
})
export class ConvertModule {}
