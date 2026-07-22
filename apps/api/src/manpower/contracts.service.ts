import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  EmployeeStatus,
  ManpowerContractStatus,
  PartnerType,
  Prisma,
  TimesheetStatus,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateAssignmentDto, CreateContractDto, UpdateAssignmentDto, UpdateContractDto } from "./dto/manpower.dtos";

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, status?: ManpowerContractStatus) {
    return this.prisma.manpowerContract.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        costCenter: { select: { code: true } },
        businessPartner: { select: { code: true, name: true } },
        _count: { select: { assignments: true, timesheets: true } },
      },
    });
  }

  async get(companyId: string, contractId: string) {
    const contract = await this.prisma.manpowerContract.findFirst({
      where: { id: contractId, companyId },
      include: {
        costCenter: true,
        businessPartner: { select: { code: true, name: true } },
        assignments: {
          orderBy: { createdAt: "asc" },
          include: { employee: { select: { code: true, nameEn: true, status: true } } },
        },
        timesheets: {
          orderBy: { createdAt: "desc" },
          include: {
            fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
            salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
      },
    });
    if (!contract) {
      throw new NotFoundException("Manpower contract not found");
    }
    return contract;
  }

  async create(companyId: string, userId: string, dto: CreateContractDto) {
    await this.getCustomer(companyId, dto.businessPartnerId);

    const contract = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.manpowerContract.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictException(`Contract code ${dto.code} already exists`);
      }
      const ccCode = `MPR-${dto.code}`;
      const ccClash = await tx.costCenter.findFirst({ where: { companyId, code: ccCode } });
      if (ccClash) {
        throw new ConflictException(`Cost center ${ccCode} already exists`);
      }
      const costCenter = await tx.costCenter.create({
        data: { companyId, code: ccCode, name: `Manpower: ${dto.name}` },
      });
      return tx.manpowerContract.create({
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
      entityName: "ManpowerContract",
      entityId: contract.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: contract,
    });

    return contract;
  }

  async update(companyId: string, contractId: string, userId: string, dto: UpdateContractDto) {
    const before = await this.getOwned(companyId, contractId);
    if (before.status === ManpowerContractStatus.CLOSED) {
      throw new ConflictException("Closed contracts cannot be edited");
    }
    const updated = await this.prisma.manpowerContract.update({
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
      entityName: "ManpowerContract",
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
    if (contract.status === ManpowerContractStatus.CLOSED) {
      throw new ConflictException("Contract is already closed");
    }
    const openTimesheets = await this.prisma.timesheet.count({
      where: { contractId, status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.APPROVED] } },
    });
    if (openTimesheets > 0) {
      throw new ConflictException("Contract has un-invoiced timesheets — invoice or delete them first");
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.costCenter.update({ where: { id: contract.costCenterId }, data: { isActive: false } });
      await tx.manpowerAssignment.updateMany({ where: { contractId }, data: { isActive: false } });
      return tx.manpowerContract.update({
        where: { id: contractId },
        data: { status: ManpowerContractStatus.CLOSED, updatedByUserId: userId },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "ManpowerContract",
      entityId: contractId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: contract.status },
      afterSnapshot: { status: ManpowerContractStatus.CLOSED },
    });

    return closed;
  }

  // ── Assignments ──────────────────────────────────────────────────────

  async createAssignment(companyId: string, contractId: string, userId: string, dto: CreateAssignmentDto) {
    const contract = await this.getOwned(companyId, contractId);
    if (contract.status !== ManpowerContractStatus.ACTIVE) {
      throw new ConflictException("Assignments require an ACTIVE contract");
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new ConflictException("Only active employees can be assigned");
    }

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException("endDate precedes startDate");
    }
    // Overlap: an existing active assignment of this employee on this
    // contract whose window intersects [startDate, endDate ?? ∞)
    const overlap = await this.prisma.manpowerAssignment.findFirst({
      where: {
        contractId,
        employeeId: dto.employeeId,
        isActive: true,
        startDate: { lte: endDate ?? new Date("9999-12-31") },
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      },
    });
    if (overlap) {
      throw new ConflictException("Employee already has an overlapping assignment on this contract");
    }

    const assignment = await this.prisma.manpowerAssignment.create({
      data: {
        contractId,
        companyId,
        employeeId: dto.employeeId,
        rateBasis: dto.rateBasis,
        billRate: new Prisma.Decimal(dto.billRate),
        otBillRate: new Prisma.Decimal(dto.otBillRate ?? "0"),
        startDate,
        endDate,
        createdByUserId: userId,
      },
      include: { employee: { select: { code: true, nameEn: true } } },
    });

    await this.auditService.log({
      companyId,
      entityName: "ManpowerAssignment",
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
    const assignment = await this.prisma.manpowerAssignment.findFirst({
      where: { id: assignmentId, contractId, companyId },
    });
    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }
    const updated = await this.prisma.manpowerAssignment.update({
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
      entityName: "ManpowerAssignment",
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
    const contract = await this.prisma.manpowerContract.findFirst({ where: { id: contractId, companyId } });
    if (!contract) {
      throw new NotFoundException("Manpower contract not found");
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
