import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, PartnerType, PurchaseQuotationStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { CreatePurchaseQuotationDto } from "./dto/create-purchase-quotation.dto";

/**
 * First stage of the purchasing cycle (Quotation → Order → Invoice). A
 * quotation never posts to the GL — it's purely a record of a vendor's
 * quoted price, matching the "draft doesn't post" convention used
 * everywhere else in this system, just with no posting step at all since
 * nothing here is a real transaction yet.
 */
@Injectable()
export class PurchaseQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: PurchaseQuotationStatus) {
    return this.prisma.purchaseQuotation.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: true, businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreatePurchaseQuotationDto) {
    const partner = await this.getVendor(companyId, dto.businessPartnerId);

    return this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.PURCHASE_QUOTATION,
        fiscalYearId: null,
      });
      const quotation = await tx.purchaseQuotation.create({
        data: {
          companyId,
          quotationNumber,
          businessPartnerId: partner.id,
          quotationDate: new Date(dto.quotationDate),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          status: PurchaseQuotationStatus.RECEIVED,
          memo: dto.memo,
          createdByUserId: userId,
          lines: {
            create: dto.lines.map((line, idx) => ({
              lineNumber: idx + 1,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatCategory: line.vatCategory,
            })),
          },
        },
        include: { lines: true, businessPartner: true },
      });

      await this.auditService.log({
        companyId,
        entityName: "PurchaseQuotation",
        entityId: quotation.id,
        action: "CREATE",
        changedByUserId: userId,
        afterSnapshot: quotation,
      });

      return quotation;
    });
  }

  async cancel(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status === PurchaseQuotationStatus.CONVERTED) {
      throw new ConflictException("This quotation has already been converted to a purchase order");
    }
    if (before.status === PurchaseQuotationStatus.CANCELLED) {
      throw new ConflictException("This quotation is already cancelled");
    }
    const cancelled = await this.prisma.purchaseQuotation.update({
      where: { id },
      data: { status: PurchaseQuotationStatus.CANCELLED },
      include: { lines: true, businessPartner: true },
    });
    await this.auditService.log({
      companyId,
      entityName: "PurchaseQuotation",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });
    return cancelled;
  }

  /**
   * Marks the quotation CONVERTED — the actual PurchaseOrder row is created
   * by PurchaseOrdersService.createFromQuotation, which calls this in the
   * same request but as a separate step (mirrors the two-phase
   * generate-invoice pattern used across this codebase: independent writes,
   * optimistically checked, rather than one giant cross-service transaction).
   */
  async markConverted(companyId: string, id: string, userId: string) {
    const linked = await this.prisma.purchaseQuotation.updateMany({
      where: { id, companyId, status: { in: [PurchaseQuotationStatus.DRAFT, PurchaseQuotationStatus.RECEIVED] } },
      data: { status: PurchaseQuotationStatus.CONVERTED },
    });
    if (linked.count === 0) {
      throw new ConflictException("Quotation status changed while converting it to a purchase order");
    }
    await this.auditService.log({
      companyId,
      entityName: "PurchaseQuotation",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: PurchaseQuotationStatus.CONVERTED },
    });
  }

  private async getOwned(companyId: string, id: string) {
    const quotation = await this.prisma.purchaseQuotation.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: true } }, businessPartner: true },
    });
    if (!quotation) {
      throw new NotFoundException("Purchase quotation not found");
    }
    return quotation;
  }

  private async getVendor(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId, isActive: true } });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.VENDOR && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a vendor`);
    }
    return partner;
  }
}
