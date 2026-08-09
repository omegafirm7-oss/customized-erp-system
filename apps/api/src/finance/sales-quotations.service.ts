import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, PartnerType, SalesQuotationStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { CreateSalesQuotationDto } from "./dto/create-sales-quotation.dto";

/**
 * First stage of the sales cycle (Quotation → Order → Invoice), mirroring
 * PurchaseQuotationsService exactly on the customer side. A quotation
 * never posts to the GL — it's purely a record of a price quoted to a
 * customer, matching the "draft doesn't post" convention used everywhere
 * else in this system, just with no posting step at all since nothing
 * here is a real transaction yet.
 */
@Injectable()
export class SalesQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: SalesQuotationStatus) {
    return this.prisma.salesQuotation.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: true, businessPartner: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreateSalesQuotationDto) {
    const partner = await this.getCustomer(companyId, dto.businessPartnerId);

    return this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.SALES_QUOTATION,
        fiscalYearId: null,
      });
      const quotation = await tx.salesQuotation.create({
        data: {
          companyId,
          quotationNumber,
          businessPartnerId: partner.id,
          quotationDate: new Date(dto.quotationDate),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          status: SalesQuotationStatus.SENT,
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
        entityName: "SalesQuotation",
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
    if (before.status === SalesQuotationStatus.CONVERTED) {
      throw new ConflictException("This quotation has already been converted to a sales order");
    }
    if (before.status === SalesQuotationStatus.CANCELLED) {
      throw new ConflictException("This quotation is already cancelled");
    }
    const cancelled = await this.prisma.salesQuotation.update({
      where: { id },
      data: { status: SalesQuotationStatus.CANCELLED },
      include: { lines: true, businessPartner: true },
    });
    await this.auditService.log({
      companyId,
      entityName: "SalesQuotation",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });
    return cancelled;
  }

  /**
   * Marks the quotation CONVERTED — the actual SalesOrder row is created by
   * SalesOrdersService.createFromQuotation, which calls this in the same
   * request but as a separate step (mirrors PurchaseQuotationsService).
   */
  async markConverted(companyId: string, id: string, userId: string) {
    const linked = await this.prisma.salesQuotation.updateMany({
      where: { id, companyId, status: { in: [SalesQuotationStatus.DRAFT, SalesQuotationStatus.SENT] } },
      data: { status: SalesQuotationStatus.CONVERTED },
    });
    if (linked.count === 0) {
      throw new ConflictException("Quotation status changed while converting it to a sales order");
    }
    await this.auditService.log({
      companyId,
      entityName: "SalesQuotation",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: SalesQuotationStatus.CONVERTED },
    });
  }

  private async getOwned(companyId: string, id: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, companyId },
      include: { lines: { include: { item: true } }, businessPartner: true },
    });
    if (!quotation) {
      throw new NotFoundException("Sales quotation not found");
    }
    return quotation;
  }

  private async getCustomer(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({ where: { id: partnerId, companyId, isActive: true } });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.CUSTOMER && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a customer`);
    }
    return partner;
  }
}
