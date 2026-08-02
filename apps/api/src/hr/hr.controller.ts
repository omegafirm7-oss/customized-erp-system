import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { Response } from "express";
import { EmployeeStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { HrSettingsService } from "./hr-settings.service";
import { EmployeesService } from "./employees.service";
import { LoansService } from "./loans.service";
import { PayrollService } from "./payroll.service";
import { WpsService } from "./wps.service";
import { TerminationService } from "./termination.service";
import { HrReportsService } from "./hr-reports.service";
import { AttendanceService } from "./attendance.service";
import { EmployeePaymentsService } from "./employee-payments.service";
import {
  CreateEmployeeDto,
  CreateEmployeePaymentDto,
  CreateLoanDto,
  CreatePayrollRunDto,
  ImportEmployeesDto,
  PostSettlementDto,
  PrefillTimesheetDto,
  RecordPaymentRecoveryDto,
  RecordSettlementPaymentDto,
  TerminationPreviewDto,
  UpdateEmployeeDto,
  UpdateHrSettingsDto,
  UpdatePayrollLineDto,
  UpsertTimesheetEntryDto,
} from "./dto/hr.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("hr")
@ApiBearerAuth()
@Controller("hr")
export class HrController {
  constructor(
    private readonly hrSettingsService: HrSettingsService,
    private readonly employeesService: EmployeesService,
    private readonly loansService: LoansService,
    private readonly payrollService: PayrollService,
    private readonly wpsService: WpsService,
    private readonly terminationService: TerminationService,
    private readonly hrReportsService: HrReportsService,
    private readonly attendanceService: AttendanceService,
    private readonly employeePaymentsService: EmployeePaymentsService,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────────

  @Get("settings")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getSettings(@CurrentCompanyId() companyId: string) {
    return this.hrSettingsService.get(companyId);
  }

  @Patch("settings")
  @Permissions(PERMISSIONS.HR_SETTINGS_MANAGE)
  async updateSettings(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateHrSettingsDto,
  ) {
    return this.hrSettingsService.update(companyId, user.sub, dto);
  }

  // ── Employees ────────────────────────────────────────────────────────

  @Get("employees")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async listEmployees(@CurrentCompanyId() companyId: string, @Query("status") status?: EmployeeStatus) {
    return this.employeesService.list(companyId, status);
  }

  @Get("employees/import/template")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", 'attachment; filename="employees_import_template.csv"')
  async importTemplate() {
    return this.employeesService.csvTemplate();
  }

  @Get("employees/expiring-documents")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async expiringDocuments(@CurrentCompanyId() companyId: string, @Query("withinDays") withinDays?: string) {
    return this.employeesService.expiringDocuments(companyId, withinDays ? Number(withinDays) : undefined);
  }

  @Get("employees/:id")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getEmployee(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.employeesService.get(companyId, id);
  }

  @Get("employees/:id/summary")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getEmployeeSummary(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.employeesService.getSummary(companyId, id);
  }

  @Get("employees/:id/timesheet-detail")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getEmployeeTimesheetDetail(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @Query("fiscalPeriodId") fiscalPeriodId?: string,
  ) {
    return this.attendanceService.timesheetDetail(companyId, id, fiscalPeriodId);
  }

  @Post("employees")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async createEmployee(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(companyId, user.sub, dto);
  }

  @Post("employees/import")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async importEmployees(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportEmployeesDto,
  ) {
    return this.employeesService.importCsv(companyId, user.sub, dto.csv);
  }

  @Patch("employees/:id")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async updateEmployee(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(companyId, id, user.sub, dto);
  }

  @Delete("employees/:id")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async deleteEmployee(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.employeesService.delete(companyId, id, user.sub);
  }

  // ── Loans ────────────────────────────────────────────────────────────

  @Get("loans")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async listLoans(@CurrentCompanyId() companyId: string, @Query("employeeId") employeeId?: string) {
    return this.loansService.list(companyId, employeeId);
  }

  @Post("employees/:id/loans")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async createLoan(
    @CurrentCompanyId() companyId: string,
    @Param("id") employeeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLoanDto,
  ) {
    return this.loansService.createAndDisburse(companyId, employeeId, user.sub, dto);
  }

  @Post("loans/:loanId/cancel")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async cancelLoan(@CurrentCompanyId() companyId: string, @Param("loanId") loanId: string, @CurrentUser() user: JwtPayload) {
    return this.loansService.cancel(companyId, loanId, user.sub);
  }

  // ── Payroll runs ─────────────────────────────────────────────────────

  @Get("payroll-runs")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async listRuns(@CurrentCompanyId() companyId: string) {
    return this.payrollService.listRuns(companyId);
  }

  @Get("payroll-runs/:id")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getRun(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.payrollService.getRun(companyId, id);
  }

  @Post("payroll-runs")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async createRun(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePayrollRunDto,
  ) {
    return this.payrollService.createDraftRun(companyId, user.sub, dto.fiscalPeriodId);
  }

  @Patch("payroll-runs/:id/lines/:lineId")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async updateLine(
    @CurrentCompanyId() companyId: string,
    @Param("id") runId: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdatePayrollLineDto,
  ) {
    return this.payrollService.updateLine(companyId, runId, lineId, dto);
  }

  @Post("payroll-runs/:id/recompute")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async recomputeRun(@CurrentCompanyId() companyId: string, @Param("id") runId: string) {
    return this.payrollService.recomputeRun(companyId, runId);
  }

  @Post("payroll-runs/:id/post")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async postRun(@CurrentCompanyId() companyId: string, @Param("id") runId: string, @CurrentUser() user: JwtPayload) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.payrollService.postRun(companyId, runId, user.sub, allowSoftClosedOverride);
  }

  @Post("payroll-runs/:id/reverse")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async reverseRun(@CurrentCompanyId() companyId: string, @Param("id") runId: string, @CurrentUser() user: JwtPayload) {
    return this.payrollService.reverseRun(companyId, runId, user.sub);
  }

  @Delete("payroll-runs/:id")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async deleteDraft(@CurrentCompanyId() companyId: string, @Param("id") runId: string) {
    return this.payrollService.deleteDraft(companyId, runId);
  }

  @Get("payroll-runs/:id/wps-file")
  @Permissions(PERMISSIONS.HR_PAYROLL_RUN)
  async wpsFile(@CurrentCompanyId() companyId: string, @Param("id") runId: string, @Res() res: Response) {
    const file = await this.wpsService.generateSif(companyId, runId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.content);
  }

  @Get("payroll-runs/:id/register.csv")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async registerCsv(@CurrentCompanyId() companyId: string, @Param("id") runId: string, @Res() res: Response) {
    const file = await this.hrReportsService.registerCsv(companyId, runId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.content);
  }

  // ── Termination ──────────────────────────────────────────────────────

  @Post("employees/:id/termination/preview")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async terminationPreview(
    @CurrentCompanyId() companyId: string,
    @Param("id") employeeId: string,
    @Body() dto: TerminationPreviewDto,
  ) {
    return this.terminationService.preview(companyId, employeeId, dto.reason, new Date(dto.lastWorkingDay));
  }

  @Post("employees/:id/termination")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async postSettlement(
    @CurrentCompanyId() companyId: string,
    @Param("id") employeeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PostSettlementDto,
  ) {
    return this.terminationService.postSettlement(
      companyId,
      employeeId,
      user.sub,
      dto.reason,
      new Date(dto.lastWorkingDay),
    );
  }

  @Post("settlements/:id/reverse")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async reverseSettlement(
    @CurrentCompanyId() companyId: string,
    @Param("id") settlementId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.terminationService.reverseSettlement(companyId, settlementId, user.sub);
  }

  @Post("employees/:id/release/payments")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async recordSettlementPayment(
    @CurrentCompanyId() companyId: string,
    @Param("id") employeeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordSettlementPaymentDto,
  ) {
    return this.terminationService.recordSettlementPayment(companyId, employeeId, user.sub, dto);
  }

  // ── Employee timesheet (day-cost overview) ──────────────────────────

  @Get("employee-timesheet")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getEmployeeTimesheet(@CurrentCompanyId() companyId: string, @Query("fiscalPeriodId") fiscalPeriodId: string) {
    return this.attendanceService.getPeriod(companyId, fiscalPeriodId);
  }

  @Post("employee-timesheet/prefill")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async prefillEmployeeTimesheet(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PrefillTimesheetDto,
  ) {
    return this.attendanceService.prefillPeriod(companyId, dto.fiscalPeriodId, user.sub);
  }

  @Post("employee-timesheet/entry")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async upsertEmployeeTimesheetEntry(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertTimesheetEntryDto,
  ) {
    return this.attendanceService.upsertEntry(companyId, user.sub, dto);
  }

  @Post("employee-timesheet/reset-hours")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async resetEmployeeTimesheetHours(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PrefillTimesheetDto,
  ) {
    return this.attendanceService.resetPeriodHours(companyId, dto.fiscalPeriodId, user.sub);
  }

  @Post("employee-timesheet/entries/:entryId/attachment")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadTimesheetEntryAttachment(
    @CurrentCompanyId() companyId: string,
    @Param("entryId") entryId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.attendanceService.uploadEntryAttachment(companyId, entryId, user.sub, file);
  }

  @Get("employee-timesheet/entries/:entryId/attachment")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getTimesheetEntryAttachment(
    @CurrentCompanyId() companyId: string,
    @Param("entryId") entryId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const attachment = await this.attendanceService.getEntryAttachment(companyId, entryId);
    res.set({ "Content-Type": attachment.mimeType, "Content-Disposition": `inline; filename="${attachment.filename}"` });
    return new StreamableFile(attachment.data);
  }

  // ── Employee payments (allowances & advances) ───────────────────────

  @Get("employees/:id/payments")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async listEmployeePayments(@CurrentCompanyId() companyId: string, @Param("id") employeeId: string) {
    return this.employeePaymentsService.listForEmployee(companyId, employeeId);
  }

  @Post("employees/:id/payments")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async createEmployeePayment(
    @CurrentCompanyId() companyId: string,
    @Param("id") employeeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEmployeePaymentDto,
  ) {
    return this.employeePaymentsService.create(companyId, employeeId, user.sub, dto);
  }

  @Post("employee-payments/:paymentId/recoveries")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async recordEmployeePaymentRecovery(
    @CurrentCompanyId() companyId: string,
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordPaymentRecoveryDto,
  ) {
    return this.employeePaymentsService.recordRecovery(companyId, paymentId, user.sub, dto);
  }

  @Post("employee-payments/:paymentId/reverse")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  async reverseEmployeePayment(
    @CurrentCompanyId() companyId: string,
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeePaymentsService.reversePayment(companyId, paymentId, user.sub);
  }

  @Post("employee-payments/:paymentId/receipt")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadEmployeePaymentReceipt(
    @CurrentCompanyId() companyId: string,
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.employeePaymentsService.uploadReceipt(companyId, paymentId, user.sub, file);
  }

  @Get("employee-payments/:paymentId/receipt")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async getEmployeePaymentReceipt(
    @CurrentCompanyId() companyId: string,
    @Param("paymentId") paymentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const attachment = await this.employeePaymentsService.getReceipt(companyId, paymentId);
    res.set({
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
    });
    return new StreamableFile(attachment.data);
  }

  // ── Reports ──────────────────────────────────────────────────────────

  @Get("reports/gosi-summary")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async gosiSummary(@CurrentCompanyId() companyId: string, @Query("fiscalPeriodId") fiscalPeriodId: string) {
    return this.hrReportsService.gosiSummary(companyId, fiscalPeriodId);
  }

  @Get("reports/eosb-liability")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async eosbLiability(@CurrentCompanyId() companyId: string) {
    return this.hrReportsService.eosbLiability(companyId);
  }

  @Get("reports/leave-balances")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async leaveBalances(@CurrentCompanyId() companyId: string) {
    return this.hrReportsService.leaveBalances(companyId);
  }

  @Get("reports/employees-dashboard")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async employeesDashboard(@CurrentCompanyId() companyId: string, @Query("fiscalPeriodId") fiscalPeriodId?: string) {
    return this.hrReportsService.employeesDashboard(companyId, fiscalPeriodId);
  }

  @Get("reports/labor-cost-by-date-range")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async laborCostByDateRange(
    @CurrentCompanyId() companyId: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
    @Query("trades") trades?: string,
  ) {
    const tradeList = trades ? trades.split(",").filter(Boolean) : undefined;
    return this.hrReportsService.laborCostByDateRange(companyId, fromDate, toDate, tradeList);
  }

  @Get("reports/active-employees-detail")
  @Permissions(PERMISSIONS.HR_EMPLOYEE_VIEW)
  async activeEmployeesDetail(@CurrentCompanyId() companyId: string, @Query("fiscalPeriodId") fiscalPeriodId?: string) {
    return this.hrReportsService.activeEmployeesDetail(companyId, fiscalPeriodId);
  }
}
