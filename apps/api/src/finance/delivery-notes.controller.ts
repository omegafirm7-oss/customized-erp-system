import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import {
  CreateDeliveryNoteDto,
  DeliveryNotesService,
  MarkDeliveredDto,
  UpdateDeliveryLineDto,
  UpdateDeliveryNoteDto,
} from "./delivery-notes.service";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered globally in AppModule.
// Delivery notes belong to sales orders, so they reuse the sales-order permissions.
@ApiTags("delivery-notes")
@ApiBearerAuth()
@Controller("ar/delivery-notes")
@RequiresModule(MODULE_KEYS.SALES)
export class DeliveryNotesController {
  constructor(private readonly service: DeliveryNotesService) {}

  @Get()
  @Permissions(PERMISSIONS.AR_ORDER_VIEW)
  async list(@CurrentCompanyId() companyId: string, @Query("salesOrderId") salesOrderId?: string) {
    return this.service.list(companyId, salesOrderId);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AR_ORDER_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.service.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateDeliveryNoteDto) {
    return this.service.create(companyId, user.sub, dto);
  }

  @Post(":id/update")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async update(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdateDeliveryNoteDto,
  ) {
    return this.service.update(companyId, id, user.sub, dto);
  }

  @Post(":id/lines/:lineId")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async updateLine(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdateDeliveryLineDto,
  ) {
    return this.service.updateLine(companyId, id, lineId, dto);
  }

  @Post(":id/dispatch")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async dispatch(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.service.dispatch(companyId, id, user.sub);
  }

  @Post(":id/delivered")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async delivered(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: MarkDeliveredDto,
  ) {
    return this.service.markDelivered(companyId, id, user.sub, dto);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AR_ORDER_MANAGE)
  async cancel(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.service.cancel(companyId, id, user.sub);
  }
}
