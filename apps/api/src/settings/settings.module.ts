import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TemplateSettingsService } from "./template-settings.service";
import { TemplateSettingsController } from "./template-settings.controller";

@Module({
  imports: [AuditModule],
  controllers: [TemplateSettingsController],
  providers: [TemplateSettingsService],
})
export class SettingsModule {}
