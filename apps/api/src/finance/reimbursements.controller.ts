import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsNumberString, IsOptional, IsString, IsUUID } from "class-validator";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ReimbursementsService } from "./reimbursements.service";

class CreatePayeeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  role?: string;
}

class RecordExpenseDto {
  @IsDateString()
  date!: string;

  @IsString()
  supplierName!: string;

  @IsOptional()
  @IsString()
  supplierVat?: string;

  @IsString()
  receiptNumber!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsUUID()
  accountId!: string;

  @IsString()
  description!: string;

  @IsNumberString()
  amount!: string;

  @IsBoolean()
  hasVatInvoice!: boolean;

  @IsBoolean()
  post!: boolean;
}

class ReimburseDto {
  @IsDateString()
  paymentDate!: string;

  @IsUUID()
  bankCashAccountId!: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  invoiceIds?: string[];

  @IsOptional()
  @IsString()
  reference?: string;
}

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("reimbursements")
@ApiBearerAuth()
@Controller("reimbursements")
export class ReimbursementsController {
  constructor(private readonly service: ReimbursementsService) {}

  @Get("payees")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async listPayees(@CurrentCompanyId() companyId: string) {
    return this.service.listPayees(companyId);
  }

  @Post("payees")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async createPayee(@CurrentCompanyId() companyId: string, @Body() dto: CreatePayeeDto) {
    return this.service.createPayee(companyId, dto.name, dto.role ?? "");
  }

  @Get("payees/:id/statement")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async statement(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.service.statement(companyId, id);
  }

  @Post("payees/:id/expenses")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async recordExpense(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: RecordExpenseDto,
  ) {
    const canPost = user.permissions.includes(PERMISSIONS.AP_INVOICE_POST);
    return this.service.recordExpense(companyId, user.sub, canPost, { ...dto, payeeId: id });
  }

  @Post("payees/:id/reimburse")
  @Permissions(PERMISSIONS.PAYMENT_CREATE)
  async reimburse(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: ReimburseDto,
  ) {
    return this.service.reimburse(companyId, user.sub, id, dto);
  }
}
