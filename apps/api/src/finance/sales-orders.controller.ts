import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SalesOrderStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { SalesOrdersService } from "./sales-orders.service";
import { CreateSalesOrderDto, GenerateSalesInvoiceDto } from "./dto/create-sales-order.dto";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered
// globally in AppModule.
@ApiTags("sales-orders")
@ApiBearerAuth()
@Controller("ar/orders")
@RequiresModule(MODULE_KEYS.SALES)
export class SalesOrdersController {
  constructor(private readonly ordersService: SalesOrdersService) {}

  @Get()
  @Permissions(PERMISSIONS.AR_ORDER_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: SalesOrderStatus) {
    return this.ordersService.list(companyId, status);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AR_ORDER_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.ordersService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.ordersService.create(companyId, user.sub, dto);
  }

  @Post("from-quotation/:quotationId")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async createFromQuotation(
    @CurrentCompanyId() companyId: string,
    @Param("quotationId") quotationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.createFromQuotation(companyId, user.sub, quotationId);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.cancel(companyId, id, user.sub);
  }

  @Post(":id/generate-invoice")
  @Permissions(PERMISSIONS.AR_INVOICE_CREATE)
  async generateInvoice(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateSalesInvoiceDto,
  ) {
    return this.ordersService.generateInvoice(companyId, id, user.sub, dto);
  }
}
