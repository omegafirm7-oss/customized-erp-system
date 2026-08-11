import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
// FinanceModule provides ApService for invoice generation (no cycle —
// finance does not import hired-equipment). AccountResolutionService is
// provided directly (stateless) like in Manpower/Inventory/Projects/HR.
import { FinanceModule } from "../finance/finance.module";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { ContractsService } from "./contracts.service";
import { TimesheetsService } from "./timesheets.service";
import { BillingService } from "./billing.service";
import { HiredEquipmentController } from "./hired-equipment.controller";

@Module({
  imports: [FinanceModule, AuditModule],
  controllers: [HiredEquipmentController],
  providers: [AccountResolutionService, ContractsService, TimesheetsService, BillingService],
  exports: [ContractsService],
})
export class HiredEquipmentModule {}
