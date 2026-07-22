import { Module } from "@nestjs/common";
import { GlModule } from "../gl/gl.module";
import { AuditModule } from "../audit/audit.module";
// Provided directly (stateless) to avoid importing FinanceModule and creating
// a module cycle — the same pattern as InventoryModule.
import { AccountResolutionService } from "../finance/account-resolution.service";
import { ProjectsService } from "./projects.service";
import { RevenueRecognitionService } from "./revenue-recognition.service";
import { ProjectsController } from "./projects.controller";

@Module({
  imports: [GlModule, AuditModule],
  controllers: [ProjectsController],
  providers: [AccountResolutionService, ProjectsService, RevenueRecognitionService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
