import { Body, Controller, Delete, Get, Header, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { PartnersService } from "./partners.service";
import { CreateBusinessPartnerDto, ImportPartnersDto } from "./dto/create-business-partner.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("business-partners")
@ApiBearerAuth()
@Controller("partners")
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  async list(@CurrentCompanyId() companyId: string) {
    return this.partnersService.list(companyId);
  }

  @Get("import/template")
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", 'attachment; filename="partners_import_template.csv"')
  async importTemplate() {
    return this.partnersService.csvTemplate();
  }

  @Post("import")
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  async importPartners(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportPartnersDto,
  ) {
    return this.partnersService.importCsv(companyId, user.sub, dto.csv);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.partnersService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @Body() dto: CreateBusinessPartnerDto) {
    return this.partnersService.create(companyId, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.PARTNER_CUSTOMER_MANAGE)
  async deactivate(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.partnersService.deactivate(companyId, id);
  }
}
