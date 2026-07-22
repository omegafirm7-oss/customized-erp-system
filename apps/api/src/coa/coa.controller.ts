import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { PERMISSIONS } from "@erp/shared-constants";
import { CoaService } from "./coa.service";
import { CreateAccountDto } from "./dto/create-account.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("chart-of-accounts")
@ApiBearerAuth()
@Controller("coa/accounts")
export class CoaController {
  constructor(private readonly coaService: CoaService) {}

  @Get()
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async list(@CurrentCompanyId() companyId: string) {
    return this.coaService.listAccounts(companyId);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.JOURNAL_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.coaService.getAccount(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @Body() dto: CreateAccountDto) {
    return this.coaService.createAccount(companyId, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async deactivate(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.coaService.deactivateAccount(companyId, id);
  }
}
