import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ZatcaApiClient } from "./zatca-api.client";
import { ZatcaDeviceService } from "./zatca-device.service";
import { ZatcaSubmissionService } from "./zatca-submission.service";
import { ZatcaController } from "./zatca.controller";

@Module({
  imports: [AuditModule],
  controllers: [ZatcaController],
  providers: [ZatcaApiClient, ZatcaDeviceService, ZatcaSubmissionService],
  exports: [ZatcaSubmissionService, ZatcaDeviceService],
})
export class ZatcaModule {}
