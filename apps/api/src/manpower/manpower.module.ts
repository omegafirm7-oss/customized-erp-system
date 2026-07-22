import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
// FinanceModule provides ArService for invoice generation (no cycle —
// finance does not import manpower). AccountResolutionService is provided
// directly (stateless) like in Inventory/Projects/HrModule.
import { FinanceModule } from "../finance/finance.module";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { ContractsService } from "./contracts.service";
import { TimesheetsService } from "./timesheets.service";
import { BillingService } from "./billing.service";
import { ManpowerReportsService } from "./manpower-reports.service";
import { ManpowerController } from "./manpower.controller";

@Module({
  imports: [FinanceModule, AuditModule],
  controllers: [ManpowerController],
  providers: [AccountResolutionService, ContractsService, TimesheetsService, BillingService, ManpowerReportsService],
  exports: [ContractsService],
})
export class ManpowerModule {}
