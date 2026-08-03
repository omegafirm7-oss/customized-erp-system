import { Module } from "@nestjs/common";
import { NumberingModule } from "../numbering/numbering.module";
import { GlModule } from "../gl/gl.module";
import { AuditModule } from "../audit/audit.module";
// FinanceModule provides ArService for invoice generation (no cycle).
// AccountResolutionService is provided directly (stateless) like the other
// posting modules.
import { FinanceModule } from "../finance/finance.module";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { EquipmentService } from "./equipment.service";
import { EquipmentContractsService } from "./equipment-contracts.service";
import { UsageLogsService } from "./usage-logs.service";
import { EquipmentBillingService } from "./equipment-billing.service";
import { DepreciationService } from "./depreciation.service";
import { EquipmentReportsService } from "./equipment-reports.service";
import { ProjectEquipmentService } from "./project-equipment.service";
import { EquipmentController } from "./equipment.controller";

@Module({
  imports: [NumberingModule, GlModule, AuditModule, FinanceModule],
  controllers: [EquipmentController],
  providers: [
    AccountResolutionService,
    EquipmentService,
    EquipmentContractsService,
    UsageLogsService,
    EquipmentBillingService,
    DepreciationService,
    EquipmentReportsService,
    ProjectEquipmentService,
  ],
  exports: [EquipmentService],
})
export class EquipmentModule {}
