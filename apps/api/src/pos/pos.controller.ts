import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { PosTerminal } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Public } from "../common/decorators/public.decorator";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PosApiKeyGuard } from "./pos-api-key.guard";
import { PosSalesService } from "./pos-sales.service";
import { PosTerminalsService } from "./pos-terminals.service";
import { PosDashboardService } from "./pos-dashboard.service";
import { CreatePosReturnDto, CreatePosSaleDto, CreatePosTerminalDto, UpdatePosTerminalDto } from "./dto/pos.dto";

/**
 * Inbound API for the client's POS software. Authenticated by the
 * terminal's X-POS-Key (not a user JWT); versioned under /pos/v1 because
 * third-party tills will hard-code it.
 */
@ApiTags("pos-inbound")
@ApiHeader({ name: "X-POS-Key", required: true })
@Public()
@UseGuards(PosApiKeyGuard)
@Controller("pos/v1")
export class PosInboundController {
  constructor(private readonly salesService: PosSalesService) {}

  @Post("sales")
  @HttpCode(200)
  async createSale(@Req() req: { posTerminal: PosTerminal }, @Body() dto: CreatePosSaleDto) {
    return this.salesService.recordSale(req.posTerminal, dto);
  }

  @Get("sales/:clientSaleId")
  async getSale(@Req() req: { posTerminal: PosTerminal }, @Param("clientSaleId") clientSaleId: string) {
    return this.salesService.getSale(req.posTerminal, clientSaleId);
  }

  @Post("sales/:clientSaleId/returns")
  @HttpCode(200)
  async createReturn(
    @Req() req: { posTerminal: PosTerminal },
    @Param("clientSaleId") clientSaleId: string,
    @Body() dto: CreatePosReturnDto,
  ) {
    return this.salesService.recordReturn(req.posTerminal, clientSaleId, dto);
  }
}

/**
 * Counter billing screen (ERP web app) — a logged-in cashier sells through a
 * terminal. Same service as the API-key inbound route, so the accounting,
 * FBR reporting and idempotency are identical.
 */
@ApiTags("pos")
@ApiBearerAuth()
@RequiresModule(MODULE_KEYS.FBR)
@Controller("pos/counter/:terminalId")
export class PosCounterController {
  constructor(
    private readonly salesService: PosSalesService,
    private readonly terminalsService: PosTerminalsService,
  ) {}

  /** Sellable catalogue for the counter (cashiers need no item-master rights). */
  @Get("items")
  @Permissions(PERMISSIONS.POS_SELL)
  async items(@CurrentCompanyId() companyId: string, @Param("terminalId") terminalId: string) {
    await this.terminalsService.getActive(companyId, terminalId);
    return this.salesService.listSellableItems(companyId);
  }

  @Get("sales")
  @Permissions(PERMISSIONS.POS_SELL)
  async list(@CurrentCompanyId() companyId: string, @Param("terminalId") terminalId: string, @Query("date") date: string) {
    return this.salesService.listSales(await this.terminalsService.getActive(companyId, terminalId), date);
  }

  @Post("sales")
  @HttpCode(200)
  @Permissions(PERMISSIONS.POS_SELL)
  async sell(@CurrentCompanyId() companyId: string, @Param("terminalId") terminalId: string, @Body() dto: CreatePosSaleDto) {
    return this.salesService.recordSale(await this.terminalsService.getActive(companyId, terminalId), dto);
  }

  @Get("sales/:clientSaleId")
  @Permissions(PERMISSIONS.POS_SELL)
  async get(@CurrentCompanyId() companyId: string, @Param("terminalId") terminalId: string, @Param("clientSaleId") clientSaleId: string) {
    return this.salesService.getSale(await this.terminalsService.getActive(companyId, terminalId), clientSaleId);
  }

  @Post("sales/:clientSaleId/returns")
  @HttpCode(200)
  @Permissions(PERMISSIONS.POS_SELL)
  async createReturn(
    @CurrentCompanyId() companyId: string,
    @Param("terminalId") terminalId: string,
    @Param("clientSaleId") clientSaleId: string,
    @Body() dto: CreatePosReturnDto,
  ) {
    return this.salesService.recordReturn(await this.terminalsService.getActive(companyId, terminalId), clientSaleId, dto);
  }
}

/** Owner dashboard (Pakistan retail / clinic): sales, FBR status, tax. */
@ApiTags("pos")
@ApiBearerAuth()
@RequiresModule(MODULE_KEYS.FBR)
@Controller("pos/dashboard")
export class PosDashboardController {
  constructor(private readonly dashboardService: PosDashboardService) {}

  @Get()
  @Permissions(PERMISSIONS.FBR_SUBMISSION_VIEW)
  async summary(@CurrentCompanyId() companyId: string) {
    return this.dashboardService.summary(companyId);
  }
}

/** Terminal administration for ERP users. */
@ApiTags("pos")
@ApiBearerAuth()
@RequiresModule(MODULE_KEYS.FBR)
@Controller("pos/terminals")
export class PosTerminalsController {
  constructor(private readonly terminalsService: PosTerminalsService) {}

  @Get()
  @Permissions(PERMISSIONS.POS_TERMINAL_MANAGE)
  async list(@CurrentCompanyId() companyId: string) {
    return this.terminalsService.list(companyId);
  }

  /** Active terminals for the counter screen picker (cashiers, no admin rights). */
  @Get("active")
  @Permissions(PERMISSIONS.POS_SELL)
  async listActive(@CurrentCompanyId() companyId: string) {
    return this.terminalsService.listActive(companyId);
  }

  @Get("daily-summary")
  @Permissions(PERMISSIONS.POS_TERMINAL_MANAGE)
  async dailySummary(@CurrentCompanyId() companyId: string, @Query("date") date: string) {
    return this.terminalsService.dailySummary(companyId, date);
  }

  @Post()
  @Permissions(PERMISSIONS.POS_TERMINAL_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreatePosTerminalDto) {
    return this.terminalsService.create(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.POS_TERMINAL_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdatePosTerminalDto,
  ) {
    return this.terminalsService.update(companyId, user.sub, id, dto);
  }

  @Post(":id/rotate-key")
  @Permissions(PERMISSIONS.POS_TERMINAL_MANAGE)
  async rotateKey(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.terminalsService.rotateKey(companyId, user.sub, id);
  }
}
