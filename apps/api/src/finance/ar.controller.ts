import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { InvoiceStatus, SalesDocumentKind } from "@prisma/client";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ArService } from "./ar.service";
import { CreateSalesInvoiceDto } from "./dto/create-sales-invoice.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("accounts-receivable")
@ApiBearerAuth()
@Controller("ar/invoices")
export class ArController {
  constructor(private readonly arService: ArService) {}

  @Get()
  @Permissions(PERMISSIONS.AR_INVOICE_VIEW)
  async list(
    @CurrentCompanyId() companyId: string,
    @Query("status") status?: InvoiceStatus,
    @Query("partnerId") partnerId?: string,
    @Query("kind") kind?: SalesDocumentKind,
  ) {
    return this.arService.list(companyId, { status, businessPartnerId: partnerId, documentKind: kind });
  }

  @Get("open")
  @Permissions(PERMISSIONS.AR_INVOICE_VIEW)
  async listOpen(@CurrentCompanyId() companyId: string, @Query("partnerId") partnerId?: string) {
    return this.arService.listOpen(companyId, partnerId);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AR_INVOICE_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.arService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AR_INVOICE_CREATE)
  async createDraft(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.arService.createDraft(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.AR_INVOICE_CREATE)
  async updateDraft(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.arService.updateDraft(companyId, id, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.AR_INVOICE_CREATE)
  async deleteDraft(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.arService.deleteDraft(companyId, id);
  }

  @Post(":id/post")
  @Permissions(PERMISSIONS.AR_INVOICE_POST)
  async post(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.arService.postInvoice(companyId, id, user.sub, allowSoftClosedOverride);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AR_INVOICE_CANCEL)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.arService.cancelInvoice(companyId, id, user.sub);
  }
}
