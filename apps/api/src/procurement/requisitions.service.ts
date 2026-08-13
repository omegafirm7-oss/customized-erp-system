import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, PurchaseRequisitionStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { CreatePurchaseRequisitionDto, RejectRequisitionDto } from "./dto/procurement.dtos";

/**
 * First stage of the purchasing cycle, ahead of Quotation → Order →
 * Invoice: an internal request that must be approved before any vendor is
 * contacted. Never posts to the GL. Approved requisitions can seed one or
 * more vendor RFQs (see PurchaseQuotationsService.create sourceRequisitionId)
 * — multiple quotations against the same requisition support multi-vendor
 * comparison, and converting one to a PO auto-closes the requisition (see
 * PurchaseOrdersService.createFromQuotation).
 */
@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: PurchaseRequisitionStatus) {
    return this.prisma.purchaseRequisition.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: true, project: { select: { code: true, name: true } } },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOwned(companyId, id);
  }

  async create(companyId: string, userId: string, dto: CreatePurchaseRequisitionDto) {
    if (dto.projectId) {
      await this.getProject(companyId, dto.projectId);
    }
    const requisition = await this.prisma.purchaseRequisition.create({
      data: {
        companyId,
        requestedByUserId: userId,
        createdByUserId: userId,
        projectId: dto.projectId,
        requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : undefined,
        memo: dto.memo,
        lines: {
          create: dto.lines.map((line, idx) => ({
            lineNumber: idx + 1,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            estimatedUnitPrice: line.estimatedUnitPrice,
          })),
        },
      },
      include: { lines: true, project: { select: { code: true, name: true } } },
    });

    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: requisition.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: requisition,
    });

    return requisition;
  }

  /** DRAFT → PENDING_APPROVAL; allocates the requisition number. */
  async submit(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new ConflictException("Only draft requisitions can be submitted");
    }

    const submitted = await this.prisma.$transaction(async (tx) => {
      const requisitionNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.PURCHASE_REQUISITION,
        fiscalYearId: null,
      });
      return tx.purchaseRequisition.update({
        where: { id },
        data: { status: PurchaseRequisitionStatus.PENDING_APPROVAL, requisitionNumber },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: submitted,
    });
    return submitted;
  }

  async approve(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new ConflictException("Only requisitions pending approval can be approved");
    }
    const approved = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: PurchaseRequisitionStatus.APPROVED, approvedByUserId: userId, approvedAt: new Date() },
    });
    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: approved,
    });
    return approved;
  }

  async reject(companyId: string, id: string, userId: string, dto: RejectRequisitionDto) {
    const before = await this.getOwned(companyId, id);
    if (before.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new ConflictException("Only requisitions pending approval can be rejected");
    }
    const rejected = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: PurchaseRequisitionStatus.REJECTED, rejectionReason: dto.reason },
    });
    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: rejected,
    });
    return rejected;
  }

  async cancel(companyId: string, id: string, userId: string) {
    const before = await this.getOwned(companyId, id);
    if (before.status === PurchaseRequisitionStatus.CLOSED || before.status === PurchaseRequisitionStatus.CANCELLED) {
      throw new ConflictException(`This requisition is already ${before.status}`);
    }
    const cancelled = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: PurchaseRequisitionStatus.CANCELLED },
    });
    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: cancelled,
    });
    return cancelled;
  }

  /**
   * Marks the requisition CLOSED once one of its RFQs converts to a PO.
   * Optimistic, mirrors PurchaseQuotationsService.markConverted — a
   * separate write, not part of the PO-creation transaction.
   */
  async markClosed(companyId: string, id: string, userId: string) {
    const linked = await this.prisma.purchaseRequisition.updateMany({
      where: { id, companyId, status: PurchaseRequisitionStatus.APPROVED },
      data: { status: PurchaseRequisitionStatus.CLOSED },
    });
    if (linked.count === 0) return;
    await this.auditService.log({
      companyId,
      entityName: "PurchaseRequisition",
      entityId: id,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: PurchaseRequisitionStatus.CLOSED },
    });
  }

  private async getOwned(companyId: string, id: string) {
    const requisition = await this.prisma.purchaseRequisition.findFirst({
      where: { id, companyId },
      include: {
        lines: { include: { item: true } },
        project: { select: { code: true, name: true } },
        quotations: {
          include: { businessPartner: { select: { code: true, name: true } }, lines: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!requisition) {
      throw new NotFoundException("Purchase requisition not found");
    }
    return requisition;
  }

  private async getProject(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) {
      throw new BadRequestException("Project not found");
    }
    return project;
  }
}
