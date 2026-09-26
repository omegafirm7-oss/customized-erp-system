import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FbrApiClient } from "./fbr-api.client";
import { FbrController } from "./fbr.controller";
import { FbrRetryWorker } from "./fbr-retry.worker";
import { FbrSettingsService } from "./fbr-settings.service";
import { FbrSubmissionService } from "./fbr-submission.service";

/**
 * FBR core: transport, settings, submission lifecycle. Imported by
 * FinanceModule (AR posting hook). The POS inbound API lives in PosModule,
 * which depends on FinanceModule — kept separate to avoid a cycle.
 */
@Module({
  imports: [AuditModule],
  controllers: [FbrController],
  providers: [FbrApiClient, FbrSettingsService, FbrSubmissionService, FbrRetryWorker],
  exports: [FbrApiClient, FbrSubmissionService, FbrSettingsService, FbrRetryWorker],
})
export class FbrModule {}
