import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { InvoiceStatus } from "@prisma/client";
import { memoryStorage } from "multer";
import { Response } from "express";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ApService } from "./ap.service";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto";
import { UpdatePurchaseInvoiceDto } from "./dto/update-purchase-invoice.dto";

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("accounts-payable")
@ApiBearerAuth()
@Controller("ap/invoices")
export class ApController {
  constructor(private readonly apService: ApService) {}

  @Get()
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async list(
    @CurrentCompanyId() companyId: string,
    @Query("status") status?: InvoiceStatus,
    @Query("partnerId") partnerId?: string,
  ) {
    return this.apService.list(companyId, { status, businessPartnerId: partnerId });
  }

  @Get("open")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async listOpen(@CurrentCompanyId() companyId: string, @Query("partnerId") partnerId?: string) {
    return this.apService.listOpen(companyId, partnerId);
  }

  @Get("import/expenses/template")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  @Header("Content-Disposition", 'attachment; filename="expenses_import_template.xlsx"')
  importExpensesTemplate() {
    // A raw Buffer returned from a normal handler gets JSON-serialized by
    // Nest (`{"type":"Buffer","data":[...]}`) instead of sent as binary —
    // StreamableFile is the documented way to stream real binary content.
    return new StreamableFile(this.apService.expensesXlsxTemplate(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  @Post("import/expenses")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async importExpenses(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.apService.importExpensesXlsx(companyId, user.sub, file.buffer);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async get(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.apService.get(companyId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async createDraft(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.apService.createDraft(companyId, user.sub, dto);
  }

  @Patch(":id")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async updateDraft(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdatePurchaseInvoiceDto,
  ) {
    return this.apService.updateDraft(companyId, user.sub, id, dto);
  }

  @Delete(":id")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  async deleteDraft(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.apService.deleteDraft(companyId, id);
  }

  @Post(":id/post")
  @Permissions(PERMISSIONS.AP_INVOICE_POST)
  async post(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const allowSoftClosedOverride = user.permissions.includes(PERMISSIONS.PERIOD_POST_SOFT_CLOSED);
    return this.apService.postInvoice(companyId, id, user.sub, allowSoftClosedOverride);
  }

  @Post(":id/cancel")
  @Permissions(PERMISSIONS.AP_INVOICE_CANCEL)
  async cancel(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.apService.cancelInvoice(companyId, id, user.sub);
  }

  @Post("lines/:lineId/attachment")
  @Permissions(PERMISSIONS.AP_INVOICE_CREATE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadLineAttachment(
    @CurrentCompanyId() companyId: string,
    @Param("lineId") lineId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.apService.uploadLineAttachment(companyId, lineId, user.sub, file);
  }

  @Get("lines/:lineId/attachment")
  @Permissions(PERMISSIONS.AP_INVOICE_VIEW)
  async getLineAttachment(
    @CurrentCompanyId() companyId: string,
    @Param("lineId") lineId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const attachment = await this.apService.getLineAttachment(companyId, lineId);
    res.set({ "Content-Type": attachment.mimeType, "Content-Disposition": `inline; filename="${attachment.filename}"` });
    return new StreamableFile(attachment.data);
  }
}
