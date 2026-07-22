import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { ItemsService } from "./items.service";
import { CreateItemDto } from "./dto/create-item.dto";
import { CreateUomDto } from "./dto/create-uom.dto";
import { CreateWarehouseDto } from "./dto/create-warehouse.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("items")
@ApiBearerAuth()
@Controller()
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get("items")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async listItems(@CurrentCompanyId() companyId: string) {
    return this.itemsService.listItems(companyId);
  }

  @Get("items/:id")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async getItem(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.itemsService.getItem(companyId, id);
  }

  @Post("items")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async createItem(@CurrentCompanyId() companyId: string, @Body() dto: CreateItemDto) {
    return this.itemsService.createItem(companyId, dto);
  }

  @Delete("items/:id")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async deactivateItem(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.itemsService.deactivateItem(companyId, id);
  }

  @Get("uoms")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async listUoMs(@CurrentCompanyId() companyId: string) {
    return this.itemsService.listUoMs(companyId);
  }

  @Post("uoms")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async createUoM(@CurrentCompanyId() companyId: string, @Body() dto: CreateUomDto) {
    return this.itemsService.createUoM(companyId, dto);
  }

  @Get("warehouses")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async listWarehouses(@CurrentCompanyId() companyId: string) {
    return this.itemsService.listWarehouses(companyId);
  }

  @Post("warehouses")
  @Permissions(PERMISSIONS.ITEM_MANAGE)
  async createWarehouse(@CurrentCompanyId() companyId: string, @Body() dto: CreateWarehouseDto) {
    return this.itemsService.createWarehouse(companyId, dto);
  }
}
