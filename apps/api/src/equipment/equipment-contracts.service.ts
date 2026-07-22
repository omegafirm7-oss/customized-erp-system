import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  EquipmentStatus,
  ManpowerContractStatus,
  PartnerType,
  Prisma,
  TimesheetStatus,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  CreateEquipmentAssignmentDto,
  CreateEquipmentContractDto,
  UpdateEquipmentAssignmentDto,
} from "./dto/equipment.dtos";

@Injectable()
export class EquipmentContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: ManpowerContractStatus) {
    return this.prisma.equipmentRentalContract.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        costCenter: { select: { code: true } },
        businessPartner: { select: { code: true, name: true } },
        _count: { select: { assignments: true, usageLogs: true } },
      },
    });
  }

  async get(companyId: string, contractId: string) {
    const contract = await this.prisma.equipmentRentalContract.findFirst({
      where: { id: contractId, companyId },
      include: {
        costCenter: true,
        businessPartner: { select: { code: true, name: true } },
        assignments: {
          orderBy: { createdAt: "asc" },
          include: { equipment: { select: { code: true, name: true, status: true } } },
        },
        usageLogs: {
          orderBy: { createdAt: "desc" },
          include: {
            fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
            salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
      },
    });
    if (!contract) {
      throw new NotFoundException("Equipment rental contract not found");
    }
    return contract;
  }

  async create(companyId: string, userId: string, dto: CreateEquipmentContractDto) {
    await this.getCustomer(companyId, dto.businessPartnerId);

    const contract = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.equipmentRentalContract.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictException(`Contract code ${dto.code} already exists`);
      }
      const ccCode = `EQR-${dto.code}`;
      const ccClash = await tx.costCenter.findFirst({ where: { companyId, code: ccCode } });
      if (ccClash) {
        throw new ConflictException(`Cost center ${ccCode} already exists`);
      }
      const costCenter = await tx.costCenter.create({
        data: { companyId, code: ccCode, name: `Equipment: ${dto.name}` },
      });
      return tx.equipmentRentalContract.create({
        data: {
          companyId,
          code: dto.code,
          name: dto.name,
          businessPartnerId: dto.businessPartnerId,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          memo: dto.memo,
          costCenterId: costCenter.id,
          createdByUserId: userId,
        },
        include: { costCenter: true, businessPartner: { select: { code: true, name: true } } },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "EquipmentRentalContract",
      entityId: contract.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: contract,
    });

    return contract;
  }

  async close(companyId: string, contractId: string, userId: string) {
    const contract = await this.getOwned(companyId, contractId);
    if (contract.status === ManpowerContractStatus.CLOSED) {
      throw new ConflictException("Contract is already closed");
    }
    const openLogs = await this.prisma.usageLog.count({
      where: { contractId, status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.APPROVED] } },
    });
    if (openLogs > 0) {
      throw new ConflictException("Contract has un-invoiced usage logs — invoice or delete them first");
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.costCenter.update({ where: { id: contract.costCenterId }, data: { isActive: false } });
      await tx.equipmentAssignment.updateMany({ where: { contractId }, data: { isActive: false } });
      return tx.equipmentRentalContract.update({
        where: { id: contractId },
        data: { status: ManpowerContractStatus.CLOSED, updatedByUserId: userId },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "EquipmentRentalContract",
      entityId: contractId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: contract.status },
      afterSnapshot: { status: ManpowerContractStatus.CLOSED },
    });

    return closed;
  }

  // ── Assignments ──────────────────────────────────────────────────────

  async createAssignment(companyId: string, contractId: string, userId: string, dto: CreateEquipmentAssignmentDto) {
    const contract = await this.getOwned(companyId, contractId);
    if (contract.status !== ManpowerContractStatus.ACTIVE) {
      throw new ConflictException("Assignments require an ACTIVE contract");
    }
    const equipment = await this.prisma.equipment.findFirst({ where: { id: dto.equipmentId, companyId } });
    if (!equipment) {
      throw new NotFoundException("Equipment not found");
    }
    if (equipment.status !== EquipmentStatus.ACTIVE) {
      throw new ConflictException("Disposed equipment cannot be assigned");
    }

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException("endDate precedes startDate");
    }
    // A physical unit can only be on one site: overlap guard spans ALL
    // contracts, not just this one (stricter than manpower).
    const overlap = await this.prisma.equipmentAssignment.findFirst({
      where: {
        equipmentId: dto.equipmentId,
        isActive: true,
        startDate: { lte: endDate ?? new Date("9999-12-31") },
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      },
      include: { contract: { select: { code: true } } },
    });
    if (overlap) {
      throw new ConflictException(
        `Equipment is already assigned to contract ${overlap.contract.code} in an overlapping window`,
      );
    }

    const assignment = await this.prisma.equipmentAssignment.create({
      data: {
        contractId,
        companyId,
        equipmentId: dto.equipmentId,
        rateBasis: dto.rateBasis,
        billRate: new Prisma.Decimal(dto.billRate),
        startDate,
        endDate,
        createdByUserId: userId,
      },
      include: { equipment: { select: { code: true, name: true } } },
    });

    await this.auditService.log({
      companyId,
      entityName: "EquipmentAssignment",
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
    dto: UpdateEquipmentAssignmentDto,
  ) {
    const assignment = await this.prisma.equipmentAssignment.findFirst({
      where: { id: assignmentId, contractId, companyId },
    });
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }
    const updated = await this.prisma.equipmentAssignment.update({
      where: { id: assignmentId },
      data: {
        billRate: dto.billRate !== undefined ? new Prisma.Decimal(dto.billRate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        isActive: dto.isActive,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "EquipmentAssignment",
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
    const contract = await this.prisma.equipmentRentalContract.findFirst({ where: { id: contractId, companyId } });
    if (!contract) {
      throw new NotFoundException("Equipment rental contract not found");
    }
    return contract;
  }

  private async getCustomer(companyId: string, partnerId: string) {
    const partner = await this.prisma.businessPartner.findFirst({
      where: { id: partnerId, companyId, isActive: true },
    });
    if (!partner) {
      throw new NotFoundException("Business partner not found");
    }
    if (partner.partnerType !== PartnerType.CUSTOMER && partner.partnerType !== PartnerType.BOTH) {
      throw new BadRequestException(`Partner ${partner.code} is not a customer`);
    }
    return partner;
  }
}
