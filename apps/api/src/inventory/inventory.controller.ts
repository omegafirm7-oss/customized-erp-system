import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PrismaService } from "../common/prisma/prisma.service";
import { StockTransferService } from "./stock-transfer.service";
import { StockAdjustmentService } from "./stock-adjustment.service";
import { CreateStockTransferDto } from "./dto/create-stock-transfer.dto";
import { CreateStockAdjustmentDto } from "./dto/create-stock-adjustment.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("inventory")
@ApiBearerAuth()
@Controller("inventory")
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transferService: StockTransferService,
    private readonly adjustmentService: StockAdjustmentService,
  ) {}

  @Get("stock")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async stock(
    @CurrentCompanyId() companyId: string,
    @Query("itemId") itemId?: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    return this.prisma.itemWarehouseStock.findMany({
      where: { companyId, ...(itemId ? { itemId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      include: {
        item: { select: { code: true, name: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ item: { code: "asc" } }],
    });
  }

  @Get("movements")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async movements(
    @CurrentCompanyId() companyId: string,
    @Query("itemId") itemId?: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    return this.prisma.stockMovement.findMany({
      where: { companyId, ...(itemId ? { itemId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      include: {
        item: { select: { code: true, name: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  @Get("transfers")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async listTransfers(@CurrentCompanyId() companyId: string) {
    return this.transferService.list(companyId);
  }

  @Get("transfers/:id")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async getTransfer(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.transferService.get(companyId, id);
  }

  @Post("transfers")
  @Permissions(PERMISSIONS.INVENTORY_TRANSFER_CREATE)
  async createTransfer(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.transferService.create(companyId, user.sub, dto);
  }

  @Get("adjustments")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async listAdjustments(@CurrentCompanyId() companyId: string) {
    return this.adjustmentService.list(companyId);
  }

  @Get("adjustments/:id")
  @Permissions(PERMISSIONS.INVENTORY_STOCK_VIEW)
  async getAdjustment(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.adjustmentService.get(companyId, id);
  }

  @Post("adjustments")
  @Permissions(PERMISSIONS.INVENTORY_ADJUSTMENT_CREATE)
  async createAdjustment(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.adjustmentService.create(companyId, user.sub, dto);
  }
}
