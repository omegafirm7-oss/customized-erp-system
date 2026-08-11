import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { HiredEquipmentContractStatus, PartnerType, Prisma, TimesheetStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateAssignmentDto, CreateContractDto, UpdateAssignmentDto, UpdateContractDto } from "./dto/hired-equipment.dtos";

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: HiredEquipmentContractStatus, projectId?: string) {
    return this.prisma.hiredEquipmentContract.findMany({
      where: { companyId, ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { code: true, name: true } },
        businessPartner: { select: { code: true, name: true } },
        _count: { select: { assignments: true, timesheets: true } },
      },
    });
  }

  async get(companyId: string, contractId: string) {
    const contract = await this.prisma.hiredEquipmentContract.findFirst({
      where: { id: contractId, companyId },
      include: {
        project: { select: { id: true, code: true, name: true } },
        businessPartner: { select: { code: true, name: true } },
        assignments: { orderBy: { createdAt: "asc" } },
        timesheets: {
          orderBy: { createdAt: "desc" },
          include: {
            fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
            purchaseInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
      },
    });
    if (!contract) {
      throw new NotFoundException("Hired equipment contract not found");
    }
    return contract;
  }

  async create(companyId: string, userId: string, dto: CreateContractDto) {
    await this.getVendor(companyId, dto.businessPartnerId);
    await this.getProject(companyId, dto.projectId);

    const contract = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.hiredEquipmentContract.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictException(`Contract code ${dto.code} already exists`);
      }
      return tx.hiredEquipmentContract.create({
        data: {
          companyId,
          code: dto.code,
          name: dto.name,
          businessPartnerId: dto.businessPartnerId,
          projectId: dto.projectId,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          memo: dto.memo,
          createdByUserId: userId,
        },
        include: { project: { select: { code: true, name: true } }, businessPartner: { select: { code: true, name: true } } },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentContract",
      entityId: contract.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: contract,
    });

    return contract;
  }

  async update(companyId: string, contractId: string, userId: string, dto: UpdateContractDto) {
    const before = await this.getOwned(companyId, contractId);
    if (before.status === HiredEquipmentContractStatus.CLOSED) {
      throw new ConflictException("Closed contracts cannot be edited");
    }
    const updated = await this.prisma.hiredEquipmentContract.update({
      where: { id: contractId },
      data: {
        name: dto.name,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        memo: dto.memo,
        updatedByUserId: userId,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentContract",
      entityId: contractId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async close(companyId: string, contractId: string, userId: string) {
    const contract = await this.getOwned(companyId, contractId);
    if (contract.status === HiredEquipmentContractStatus.CLOSED) {
      throw new ConflictException("Contract is already closed");
    }
    const openTimesheets = await this.prisma.hiredEquipmentTimesheet.count({
      where: { contractId, status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.APPROVED] } },
    });
    if (openTimesheets > 0) {
      throw new ConflictException("Contract has un-invoiced timesheets — invoice or delete them first");
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.hiredEquipmentAssignment.updateMany({ where: { contractId }, data: { isActive: false } });
      return tx.hiredEquipmentContract.update({
        where: { id: contractId },
        data: { status: HiredEquipmentContractStatus.CLOSED, updatedByUserId: userId },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentContract",
      entityId: contractId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: contract.status },
      afterSnapshot: { status: HiredEquipmentContractStatus.CLOSED },
    });

    return closed;
  }

  // ── Assignments ──────────────────────────────────────────────────────

  async createAssignment(companyId: string, contractId: string, userId: string, dto: CreateAssignmentDto) {
    const contract = await this.getOwned(companyId, contractId);
    if (contract.status !== HiredEquipmentContractStatus.ACTIVE) {
      throw new ConflictException("Assignments require an ACTIVE contract");
    }

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException("endDate precedes startDate");
    }

    const assignment = await this.prisma.hiredEquipmentAssignment.create({
      data: {
        contractId,
        companyId,
        equipmentName: dto.equipmentName,
        equipmentType: dto.equipmentType,
        rateBasis: dto.rateBasis,
        billRate: new Prisma.Decimal(dto.billRate),
        otBillRate: new Prisma.Decimal(dto.otBillRate ?? "0"),
        startDate,
        endDate,
        createdByUserId: userId,
      },
    });

    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentAssignment",
      entityId: assignment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: assignment,
    });

    return assignment;
  }

  async updateAssignment(
    companyId: string,
    contractId: string,
    assignmentId: string,
    userId: string,
    dto: UpdateAssignmentDto,
  ) {
    const assignment = await this.prisma.hiredEquipmentAssignment.findFirst({
      where: { id: assignmentId, contractId, companyId },
    });
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }
    const updated = await this.prisma.hiredEquipmentAssignment.update({
      where: { id: assignmentId },
      data: {
        billRate: dto.billRate !== undefined ? new Prisma.Decimal(dto.billRate) : undefined,
        otBillRate: dto.otBillRate !== undefined ? new Prisma.Decimal(dto.otBillRate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        isActive: dto.isActive,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentAssignment",
      entityId: assignmentId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: assignment,
      afterSnapshot: updated,
    });
    return updated;
  }

  // ── Internals ────────────────────────────────────────────────────────

  async getOwned(companyId: string, contractId: string) {
    const contract = await this.prisma.hiredEquipmentContract.findFirst({ where: { id: contractId, companyId } });
    if (!contract) {
      throw new NotFoundException("Hired equipment contract not found");
    }
    return contract;
  }

  private async getVendor(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({
      where: { id: partnerId, companyId, isActive: true },
    });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.VENDOR && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a vendor`);
    }
    return partner;
  }

  private async getProject(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }
}
