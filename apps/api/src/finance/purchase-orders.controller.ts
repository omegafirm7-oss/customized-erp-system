import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PurchaseOrderStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { CreatePurchaseOrderDto, GeneratePurchaseInvoiceDto } from "./dto/create-purchase-order.dto";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered
// globally in AppModule.
@ApiTags("purchase-orders")
@ApiBearerAuth()
@Controller("ap/orders")
@RequiresModule(MODULE_KEYS.PURCHASE)
export class PurchaseOrdersController {
  constructor(private readonly ordersService: PurchaseOrdersService) {}

  @Get()
  @Permissions(PERMISSIONS.AP_ORDER_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: PurchaseOrderStatus) {
    return this.ordersService.list(companyId, status);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AP_ORDER_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.ordersService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AP_ORDER_MANAGE)
  async create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.ordersService.create(companyId, user.sub, dto);
  }

  @Post("from-quotation/:quotationId")
  @Permissions(PERMISSIONS.AP_ORDER_MANAGE)
  async createFromQuotation(
    @CurrentCompanyId() companyId: string,
    @Param("quotationId") quotationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.createFromQuotation(companyId, user.sub, quotationId);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AP_ORDER_MANAGE)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.cancel(companyId, id, user.sub);
  }

  @Get(":id/three-way-match-warning")
  @Permissions(PERMISSIONS.AP_ORDER_VIEW)
  async threeWayMatchWarning(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.ordersService.getThreeWayMatchWarning(companyId, id);
  }

  @Post(":id/generate-invoice")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async generateInvoice(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: GeneratePurchaseInvoiceDto,
  ) {
    return this.ordersService.generateInvoice(companyId, id, user.sub, dto);
  }
}
