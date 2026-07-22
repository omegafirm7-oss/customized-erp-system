import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ManpowerContractStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ContractsService } from "./contracts.service";
import { TimesheetsService } from "./timesheets.service";
import { BillingService } from "./billing.service";
import { ManpowerReportsService } from "./manpower-reports.service";
import {
  CreateAssignmentDto,
  CreateContractDto,
  CreateTimesheetDto,
  UpdateAssignmentDto,
  UpdateContractDto,
  UpsertEntryDto,
} from "./dto/manpower.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("manpower")
@ApiBearerAuth()
@Controller("manpower")
export class ManpowerController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly timesheetsService: TimesheetsService,
    private readonly billingService: BillingService,
    private readonly reportsService: ManpowerReportsService,
  ) {}

  // ── Contracts ────────────────────────────────────────────────────────

  @Get("contracts")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_VIEW)
  async listContracts(@CurrentCompanyId() companyId: string, @Query("status") status?: ManpowerContractStatus) {
    return this.contractsService.list(companyId, status);
  }

  @Get("contracts/:id")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_VIEW)
  async getContract(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.contractsService.get(companyId, id);
  }

  @Post("contracts")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_MANAGE)
  async createContract(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateContractDto,
  ) {
    return this.contractsService.create(companyId, user.sub, dto);
  }

  @Patch("contracts/:id")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_MANAGE)
  async updateContract(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contractsService.update(companyId, id, user.sub, dto);
  }

  @Post("contracts/:id/close")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_MANAGE)
  async closeContract(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.contractsService.close(companyId, id, user.sub);
  }

  // ── Assignments ──────────────────────────────────────────────────────

  @Post("contracts/:id/assignments")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_MANAGE)
  async createAssignment(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.contractsService.createAssignment(companyId, contractId, user.sub, dto);
  }

  @Patch("contracts/:id/assignments/:assignmentId")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_MANAGE)
  async updateAssignment(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.contractsService.updateAssignment(companyId, contractId, assignmentId, user.sub, dto);
  }

  // ── Timesheets ───────────────────────────────────────────────────────

  @Post("contracts/:id/timesheets")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async createTimesheet(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTimesheetDto,
  ) {
    return this.timesheetsService.create(companyId, contractId, user.sub, dto.fiscalPeriodId);
  }

  @Get("timesheets/:id")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_VIEW)
  async getTimesheet(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.timesheetsService.get(companyId, id);
  }

  @Post("timesheets/:id/prefill")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async prefillTimesheet(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.timesheetsService.prefill(companyId, id);
  }

  @Post("timesheets/:id/entries")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async upsertEntry(@CurrentCompanyId() companyId: string, @Param("id") id: string, @Body() dto: UpsertEntryDto) {
    return this.timesheetsService.upsertEntry(companyId, id, dto);
  }

  @Post("timesheets/:id/approve")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async approveTimesheet(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.timesheetsService.approve(companyId, id, user.sub);
  }

  @Post("timesheets/:id/reopen")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async reopenTimesheet(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.timesheetsService.reopen(companyId, id, user.sub);
  }

  @Delete("timesheets/:id")
  @Permissions(PERMISSIONS.MANPOWER_TIMESHEET_MANAGE)
  async deleteTimesheet(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.timesheetsService.deleteDraft(companyId, id);
  }

  // ── Billing ──────────────────────────────────────────────────────────

  @Post("timesheets/:id/generate-invoice")
  @Permissions(PERMISSIONS.MANPOWER_BILLING_GENERATE)
  async generateInvoice(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.billingService.generateInvoice(companyId, id, user.sub);
  }

  // ── Reports ──────────────────────────────────────────────────────────

  @Get("reports/contract-profitability")
  @Permissions(PERMISSIONS.MANPOWER_CONTRACT_VIEW)
  async contractProfitability(@CurrentCompanyId() companyId: string) {
    return this.reportsService.contractProfitability(companyId);
  }
}
