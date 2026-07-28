import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AnyPermissions, Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { PERMISSIONS } from "@erp/shared-constants";
import { CoaService } from "./coa.service";
import { CreateAccountDto } from "./dto/create-account.dto";
import { UpdateAccountDto } from "./dto/update-account.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("chart-of-accounts")
@ApiBearerAuth()
@Controller("coa/accounts")
export class CoaController {
  constructor(private readonly coaService: CoaService) {}

  // Read-only reference data (account names/codes) — several unrelated modules'
  // forms depend on it (HR payment dropdowns, project cost breakdowns, etc.), so
  // any of their view permissions suffices, not just GL journal access.
  @Get()
  @AnyPermissions(
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.HR_EMPLOYEE_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.MANPOWER_CONTRACT_VIEW,
    PERMISSIONS.EQUIPMENT_VIEW,
    PERMISSIONS.AP_INVOICE_VIEW,
    PERMISSIONS.AR_INVOICE_VIEW,
  )
  async list(@CurrentCompanyId() companyId: string) {
    return this.coaService.listAccounts(companyId);
  }

  @Get(":id")
  @AnyPermissions(
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.HR_EMPLOYEE_VIEW,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.MANPOWER_CONTRACT_VIEW,
    PERMISSIONS.EQUIPMENT_VIEW,
    PERMISSIONS.AP_INVOICE_VIEW,
    PERMISSIONS.AR_INVOICE_VIEW,
  )
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.coaService.getAccount(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async create(@CurrentCompanyId() companyId: string, @Body() dto: CreateAccountDto) {
    return this.coaService.createAccount(companyId, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async update(@CurrentCompanyId() companyId: string, @Param("id") id: string, @Body() dto: UpdateAccountDto) {
    return this.coaService.updateAccount(companyId, id, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.COA_ACCOUNT_MANAGE)
  async deactivate(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.coaService.deactivateAccount(companyId, id);
  }
}
