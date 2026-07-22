import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { EquipmentStatus, ManpowerContractStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { EquipmentService } from "./equipment.service";
import { EquipmentContractsService } from "./equipment-contracts.service";
import { UsageLogsService } from "./usage-logs.service";
import { EquipmentBillingService } from "./equipment-billing.service";
import { DepreciationService } from "./depreciation.service";
import { EquipmentReportsService } from "./equipment-reports.service";
import {
  CreateEquipmentAssignmentDto,
  CreateEquipmentContractDto,
  CreateEquipmentDto,
  CreateUsageLogDto,
  DisposeEquipmentDto,
  RunDepreciationDto,
  UpdateEquipmentAssignmentDto,
  UpdateEquipmentDto,
  UpsertUsageEntryDto,
} from "./dto/equipment.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("equipment")
@ApiBearerAuth()
@Controller("equipment")
export class EquipmentController {
  constructor(
    private readonly equipmentService: EquipmentService,
    private readonly contractsService: EquipmentContractsService,
    private readonly usageLogsService: UsageLogsService,
    private readonly billingService: EquipmentBillingService,
    private readonly depreciationService: DepreciationService,
    private readonly reportsService: EquipmentReportsService,
  ) {}

  // ── Fleet register ───────────────────────────────────────────────────

  @Get("units")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async listUnits(@CurrentCompanyId() companyId: string, @Query("status") status?: EquipmentStatus) {
    return this.equipmentService.list(companyId, status);
  }

  @Get("units/:id")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async getUnit(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.equipmentService.get(companyId, id);
  }

  @Post("units")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async createUnit(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateEquipmentDto) {
    return this.equipmentService.create(companyId, user.sub, dto);
  }

  @Patch("units/:id")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async updateUnit(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipmentService.update(companyId, id, user.sub, dto);
  }

  @Post("units/:id/dispose")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async disposeUnit(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: DisposeEquipmentDto,
  ) {
    return this.equipmentService.dispose(companyId, id, user.sub, dto);
  }

  @Post("units/:id/dispose/reverse")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async reverseDisposal(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.equipmentService.reverseDisposal(companyId, id, user.sub);
  }

  // ── Contracts ────────────────────────────────────────────────────────

  @Get("contracts")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async listContracts(@CurrentCompanyId() companyId: string, @Query("status") status?: ManpowerContractStatus) {
    return this.contractsService.list(companyId, status);
  }

  @Get("contracts/:id")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async getContract(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.contractsService.get(companyId, id);
  }

  @Post("contracts")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async createContract(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEquipmentContractDto,
  ) {
    return this.contractsService.create(companyId, user.sub, dto);
  }

  @Post("contracts/:id/close")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async closeContract(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.contractsService.close(companyId, id, user.sub);
  }

  @Post("contracts/:id/assignments")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async createAssignment(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEquipmentAssignmentDto,
  ) {
    return this.contractsService.createAssignment(companyId, contractId, user.sub, dto);
  }

  @Patch("contracts/:id/assignments/:assignmentId")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async updateAssignment(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEquipmentAssignmentDto,
  ) {
    return this.contractsService.updateAssignment(companyId, contractId, assignmentId, user.sub, dto);
  }

  // ── Usage logs ───────────────────────────────────────────────────────

  @Post("contracts/:id/usage-logs")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async createUsageLog(
    @CurrentCompanyId() companyId: string,
    @Param("id") contractId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateUsageLogDto,
  ) {
    return this.usageLogsService.create(companyId, contractId, user.sub, dto.fiscalPeriodId);
  }

  @Get("usage-logs/:id")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async getUsageLog(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.usageLogsService.get(companyId, id);
  }

  @Post("usage-logs/:id/prefill")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async prefillUsageLog(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.usageLogsService.prefill(companyId, id);
  }

  @Post("usage-logs/:id/entries")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async upsertEntry(@CurrentCompanyId() companyId: string, @Param("id") id: string, @Body() dto: UpsertUsageEntryDto) {
    return this.usageLogsService.upsertEntry(companyId, id, dto);
  }

  @Post("usage-logs/:id/approve")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async approveUsageLog(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.usageLogsService.approve(companyId, id, user.sub);
  }

  @Post("usage-logs/:id/reopen")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async reopenUsageLog(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.usageLogsService.reopen(companyId, id, user.sub);
  }

  @Delete("usage-logs/:id")
  @Permissions(PERMISSIONS.EQUIPMENT_MANAGE)
  async deleteUsageLog(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.usageLogsService.deleteDraft(companyId, id);
  }

  // ── Billing ──────────────────────────────────────────────────────────

  @Post("usage-logs/:id/generate-invoice")
  @Permissions(PERMISSIONS.EQUIPMENT_BILLING_GENERATE)
  async generateInvoice(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.billingService.generateInvoice(companyId, id, user.sub);
  }

  // ── Depreciation ─────────────────────────────────────────────────────

  @Get("depreciation-runs")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async listDepreciationRuns(@CurrentCompanyId() companyId: string) {
    return this.depreciationService.listRuns(companyId);
  }

  @Post("depreciation-runs")
  @Permissions(PERMISSIONS.EQUIPMENT_DEPRECIATION_RUN)
  async runDepreciation(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RunDepreciationDto,
  ) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.depreciationService.runForPeriod(companyId, user.sub, dto.fiscalPeriodId, allowSoftClosedOverride);
  }

  @Post("depreciation-runs/:id/reverse")
  @Permissions(PERMISSIONS.EQUIPMENT_DEPRECIATION_RUN)
  async reverseDepreciation(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.depreciationService.reverseRun(companyId, id, user.sub);
  }

  // ── Reports ──────────────────────────────────────────────────────────

  @Get("reports/fleet-register")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async fleetRegister(@CurrentCompanyId() companyId: string) {
    return this.reportsService.fleetRegister(companyId);
  }

  @Get("reports/contract-profitability")
  @Permissions(PERMISSIONS.EQUIPMENT_VIEW)
  async contractProfitability(@CurrentCompanyId() companyId: string) {
    return this.reportsService.contractProfitability(companyId);
  }
}
