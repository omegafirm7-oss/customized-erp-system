import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PurchaseQuotationStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PurchaseQuotationsService } from "./purchase-quotations.service";
import { CreatePurchaseQuotationDto } from "./dto/create-purchase-quotation.dto";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered
// globally in AppModule.
@ApiTags("purchase-quotations")
@ApiBearerAuth()
@Controller("ap/quotations")
@RequiresModule(MODULE_KEYS.PURCHASE)
export class PurchaseQuotationsController {
  constructor(private readonly quotationsService: PurchaseQuotationsService) {}

  @Get()
  @Permissions(PERMISSIONS.AP_QUOTATION_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("status") status?: PurchaseQuotationStatus) {
    return this.quotationsService.list(companyId, status);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AP_QUOTATION_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.quotationsService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AP_QUOTATION_MANAGE)
  async create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseQuotationDto,
  ) {
    return this.quotationsService.create(companyId, user.sub, dto);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AP_QUOTATION_MANAGE)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.quotationsService.cancel(companyId, id, user.sub);
  }
}
