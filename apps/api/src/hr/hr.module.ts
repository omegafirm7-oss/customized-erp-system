import { Module } from "@nestjs/common";
import { NumberingModule } from "../numbering/numbering.module";
import { GlModule } from "../gl/gl.module";
import { AuditModule } from "../audit/audit.module";
// Provided directly (stateless) to avoid importing FinanceModule and creating
// a module cycle — the same pattern as InventoryModule/ProjectsModule.
import { AccountResolutionService } from "../finance/account-resolution.service";
import { HrSettingsService } from "./hr-settings.service";
import { EmployeesService } from "./employees.service";
import { LoansService } from "./loans.service";
import { PayrollService } from "./payroll.service";
import { WpsService } from "./wps.service";
import { TerminationService } from "./termination.service";
import { HrReportsService } from "./hr-reports.service";
import { AttendanceService } from "./attendance.service";
import { EmployeePaymentsService } from "./employee-payments.service";
import { HrController } from "./hr.controller";

@Module({
  imports: [NumberingModule, GlModule, AuditModule],
  controllers: [HrController],
  providers: [
    AccountResolutionService,
    HrSettingsService,
    EmployeesService,
    LoansService,
    PayrollService,
    WpsService,
    TerminationService,
    HrReportsService,
    AttendanceService,
    EmployeePaymentsService,
  ],
  exports: [EmployeesService, PayrollService],
})
export class HrModule {}
