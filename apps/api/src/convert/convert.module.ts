import { Module } from "@nestjs/common";
import { ConvertController } from "./convert.controller";
import { ConvertLimiter } from "./convert-limiter";
import { ConvertService } from "./convert.service";

@Module({
  controllers: [ConvertController],
  providers: [ConvertService, ConvertLimiter],
})
export class ConvertModule {}
