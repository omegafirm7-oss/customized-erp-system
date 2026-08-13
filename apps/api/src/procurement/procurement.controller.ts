import { Body, ConflictException, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PurchaseRequisitionStatus } from "@prisma/client";
import { MODULE_KEYS, PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { RequisitionsService } from "./requisitions.service";
import { GoodsReceiptsService } from "./goods-receipts.service";
import { PurchaseQuotationsService } from "../finance/purchase-quotations.service";
import {
  CreateGoodsReceiptDto,
  CreatePurchaseRequisitionDto,
  RecordQcDto,
  RejectRequisitionDto,
  SendRfqDto,
  UpdateReceiptLineDto,
} from "./dto/procurement.dtos";

// JwtAuthGuard + PermissionsGuard + ModuleEntitlementGuard are registered
// globally in AppModule.
@ApiTags("procurement")
@ApiBearerAuth()
@RequiresModule(MODULE_KEYS.PURCHASE)
@Controller("procurement")
export class ProcurementController {
  constructor(
    private readonly requisitionsService: RequisitionsService,
    private readonly goodsReceiptsService: GoodsReceiptsService,
    private readonly quotationsService: PurchaseQuotationsService,
  ) {}

  // ── Requisitions ─────────────────────────────────────────────────────

  @Get("requisitions")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_VIEW)
  async listRequisitions(@CurrentCompanyId() companyId: string, @Query("status") status?: PurchaseRequisitionStatus) {
    return this.requisitionsService.list(companyId, status);
  }

  @Get("requisitions/:id")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_VIEW)
  async getRequisition(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.requisitionsService.get(companyId, id);
  }

  @Post("requisitions")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_MANAGE)
  async createRequisition(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseRequisitionDto,
  ) {
    return this.requisitionsService.create(companyId, user.sub, dto);
  }

  @Post("requisitions/:id/submit")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_MANAGE)
  async submitRequisition(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.requisitionsService.submit(companyId, id, user.sub);
  }

  @Post("requisitions/:id/approve")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_APPROVE)
  async approveRequisition(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.requisitionsService.approve(companyId, id, user.sub);
  }

  @Post("requisitions/:id/reject")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_APPROVE)
  async rejectRequisition(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RejectRequisitionDto,
  ) {
    return this.requisitionsService.reject(companyId, id, user.sub, dto);
  }

  @Post("requisitions/:id/cancel")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_MANAGE)
  async cancelRequisition(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.requisitionsService.cancel(companyId, id, user.sub);
  }

  /** Sends an RFQ to a vendor for this requisition — repeatable, for multi-vendor comparison. */
  @Post("requisitions/:id/send-rfq")
  @Permissions(PERMISSIONS.PURCHASE_REQUISITION_MANAGE)
  async sendRfq(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendRfqDto,
  ) {
    const requisition = await this.requisitionsService.get(companyId, id);
    if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
      throw new ConflictException("Only approved requisitions can be sent for RFQ");
    }
    return this.quotationsService.create(companyId, user.sub, {
      businessPartnerId: dto.businessPartnerId,
      quotationDate: dto.quotationDate,
      validUntil: dto.validUntil,
      sourceRequisitionId: requisition.id,
      lines: requisition.lines.map((line) => ({
        itemId: line.itemId ?? undefined,
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.estimatedUnitPrice ? line.estimatedUnitPrice.toString() : "0",
      })),
    });
  }

  // ── Goods receipts ───────────────────────────────────────────────────

  @Get("goods-receipts")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_VIEW)
  async listReceipts(@CurrentCompanyId() companyId: string, @Query("purchaseOrderId") purchaseOrderId?: string) {
    return this.goodsReceiptsService.list(companyId, purchaseOrderId);
  }

  @Get("goods-receipts/:id")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_VIEW)
  async getReceipt(@CurrentCompanyId() companyId: string, @Param("id") id: string) {
    return this.goodsReceiptsService.get(companyId, id);
  }

  @Post("goods-receipts")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_MANAGE)
  async createReceipt(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateGoodsReceiptDto,
  ) {
    return this.goodsReceiptsService.create(companyId, user.sub, dto);
  }

  @Post("goods-receipts/:id/lines/:lineId")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_MANAGE)
  async updateReceiptLine(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdateReceiptLineDto,
  ) {
    return this.goodsReceiptsService.updateLine(companyId, id, lineId, dto);
  }

  @Post("goods-receipts/:id/submit-for-qc")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_MANAGE)
  async submitForQc(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.goodsReceiptsService.submitForQc(companyId, id, user.sub);
  }

  @Post("goods-receipts/:id/lines/:lineId/qc")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_QC)
  async recordQc(
    @CurrentCompanyId() companyId: string,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordQcDto,
  ) {
    return this.goodsReceiptsService.recordQc(companyId, id, lineId, user.sub, dto);
  }

  @Post("goods-receipts/:id/complete")
  @Permissions(PERMISSIONS.GOODS_RECEIPT_QC)
  async completeReceipt(@CurrentCompanyId() companyId: string, @Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.goodsReceiptsService.complete(companyId, id, user.sub);
  }
}
