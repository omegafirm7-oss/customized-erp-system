import { Module } from "@nestjs/common";
import { GlPostingService } from "./gl-posting.service";
import { GlController } from "./gl.controller";
import { NumberingModule } from "../numbering/numbering.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [NumberingModule, AuditModule],
  controllers: [GlController],
  providers: [GlPostingService],
  exports: [GlPostingService],
})
export class GlModule {}
