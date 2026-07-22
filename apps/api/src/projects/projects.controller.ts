import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ProjectStatus } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ProjectsService } from "./projects.service";
import { RevenueRecognitionService } from "./revenue-recognition.service";
import {
  CreateCostCenterDto,
  CreateProjectDto,
  CreateWbsTaskDto,
  RunRevRecDto,
  TransitionStatusDto,
  UpdateProjectDto,
  UpdateWbsTaskDto,
} from "./dto/project.dtos";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("projects")
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly revRecService: RevenueRecognitionService,
  ) {}

  // ── Projects ─────────────────────────────────────────────────────────

  @Get("projects")
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: ProjectStatus) {
    return this.projectsService.list(companyId, status);
  }

  @Get("projects/:id")
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.projectsService.get(companyId, id);
  }

  @Post("projects")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(companyId, user.sub, dto);
  }

  @Patch("projects/:id")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(companyId, id, user.sub, dto);
  }

  @Post("projects/:id/status")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async transition(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: TransitionStatusDto,
  ) {
    return this.projectsService.transitionStatus(companyId, id, user.sub, dto.status);
  }

  // ── WBS tasks ────────────────────────────────────────────────────────

  @Post("projects/:id/tasks")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async createTask(
    @CurrentCompanyId() companyId: string,
    @Param("id") projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWbsTaskDto,
  ) {
    return this.projectsService.createTask(companyId, projectId, user.sub, dto);
  }

  @Patch("projects/:id/tasks/:taskId")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async updateTask(
    @CurrentCompanyId() companyId: string,
    @Param("id") projectId: string,
    @Param("taskId") taskId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateWbsTaskDto,
  ) {
    return this.projectsService.updateTask(companyId, projectId, taskId, user.sub, dto);
  }

  @Delete("projects/:id/tasks/:taskId")
  @Permissions(PERMISSIONS.PROJECT_MANAGE)
  async deleteTask(
    @CurrentCompanyId() companyId: string,
    @Param("id") projectId: string,
    @Param("taskId") taskId: string,
  ) {
    return this.projectsService.deleteTask(companyId, projectId, taskId);
  }

  // ── Revenue recognition ──────────────────────────────────────────────

  @Get("projects/:id/revenue-recognition/runs")
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listRuns(@CurrentCompanyId() companyId: string, @Param("id") projectId: string) {
    return this.revRecService.listRuns(companyId, projectId);
  }

  @Post("projects/:id/revenue-recognition/run")
  @Permissions(PERMISSIONS.PROJECT_REVREC_RUN)
  async run(
    @CurrentCompanyId() companyId: string,
    @Param("id") projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RunRevRecDto,
  ) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.revRecService.runForPeriod(companyId, projectId, dto.fiscalPeriodId, user.sub, allowSoftClosedOverride);
  }

  @Post("projects/:id/revenue-recognition/runs/:runId/reverse")
  @Permissions(PERMISSIONS.PROJECT_REVREC_RUN)
  async reverseRun(
    @CurrentCompanyId() companyId: string,
    @Param("id") projectId: string,
    @Param("runId") runId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.revRecService.reverseRun(companyId, projectId, runId, user.sub);
  }

  // ── Department cost centers ──────────────────────────────────────────

  @Get("cost-centers")
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async listCostCenters(@CurrentCompanyId() companyId: string) {
    return this.projectsService.listCostCenters(companyId);
  }

  @Post("cost-centers")
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async createCostCenter(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCostCenterDto,
  ) {
    return this.projectsService.createCostCenter(companyId, user.sub, dto.code, dto.name);
  }
}
