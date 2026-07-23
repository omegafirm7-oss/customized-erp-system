import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PartnerType, Prisma, ProjectStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateProjectDto, CreateWbsTaskDto, UpdateProjectDto, UpdateWbsTaskDto } from "./dto/project.dtos";

/** Legal status transitions; CLOSED is terminal. */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNED: [ProjectStatus.ACTIVE],
  ACTIVE: [ProjectStatus.COMPLETED, ProjectStatus.CLOSED],
  COMPLETED: [ProjectStatus.ACTIVE, ProjectStatus.CLOSED],
  CLOSED: [],
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── Projects ─────────────────────────────────────────────────────────

  async create(companyId: string, userId: string, dto: CreateProjectDto) {
    if (dto.businessPartnerId) {
      await this.getCustomer(companyId, dto.businessPartnerId);
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.project.findUnique({
        where: { companyId_code: { companyId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictException(`Project code ${dto.code} already exists`);
      }

      const ccCode = `PRJ-${dto.code}`;
      const ccClash = await tx.costCenter.findFirst({ where: { companyId, code: ccCode } });
      if (ccClash) {
        throw new ConflictException(`Cost center ${ccCode} already exists`);
      }

      const costCenter = await tx.costCenter.create({
        data: { companyId, code: ccCode, name: `Project: ${dto.name}` },
      });

      return tx.project.create({
        data: {
          companyId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          businessPartnerId: dto.businessPartnerId,
          recognitionMethod: dto.recognitionMethod,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          contractValue: new Prisma.Decimal(dto.contractValue ?? "0"),
          estimatedTotalCost: new Prisma.Decimal(dto.estimatedTotalCost ?? "0"),
          costCenterId: costCenter.id,
          createdByUserId: userId,
        },
        include: { costCenter: true, businessPartner: { select: { code: true, name: true } } },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "Project",
      entityId: project.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: project,
    });

    return project;
  }

  async update(companyId: string, projectId: string, userId: string, dto: UpdateProjectDto) {
    const before = await this.getOwned(companyId, projectId);
    if (before.status === ProjectStatus.CLOSED) {
      throw new ConflictException("Closed projects cannot be edited");
    }
    if (dto.businessPartnerId) {
      await this.getCustomer(companyId, dto.businessPartnerId);
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name,
        description: dto.description,
        businessPartnerId: dto.businessPartnerId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        contractValue: dto.contractValue !== undefined ? new Prisma.Decimal(dto.contractValue) : undefined,
        estimatedTotalCost: dto.estimatedTotalCost !== undefined ? new Prisma.Decimal(dto.estimatedTotalCost) : undefined,
        updatedByUserId: userId,
      },
      include: { costCenter: true, businessPartner: { select: { code: true, name: true } } },
    });

    // Estimate revisions drive POC — always audit with before/after.
    await this.auditService.log({
      companyId,
      entityName: "Project",
      entityId: projectId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });

    return updated;
  }

  async transitionStatus(companyId: string, projectId: string, userId: string, target: ProjectStatus) {
    const before = await this.getOwned(companyId, projectId);
    if (!TRANSITIONS[before.status].includes(target)) {
      throw new ConflictException(`Cannot transition project from ${before.status} to ${target}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (target === ProjectStatus.CLOSED) {
        await tx.costCenter.update({ where: { id: before.costCenterId }, data: { isActive: false } });
      }
      return tx.project.update({
        where: { id: projectId },
        data: { status: target, updatedByUserId: userId },
        include: { costCenter: true },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "Project",
      entityId: projectId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: { status: before.status },
      afterSnapshot: { status: target },
    });

    return updated;
  }

  async list(companyId: string, status?: ProjectStatus) {
    return this.prisma.project.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        costCenter: { select: { code: true } },
        businessPartner: { select: { code: true, name: true } },
        _count: { select: { tasks: true, revenueRecognitionRuns: true } },
      },
    });
  }

  async get(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      include: {
        costCenter: true,
        businessPartner: { select: { code: true, name: true } },
        tasks: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] },
        revenueRecognitionRuns: {
          orderBy: { createdAt: "desc" },
          include: { fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } } },
        },
      },
    });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  /**
   * Real cost breakdown by expense account, plus how much of that cost is
   * still unpaid — sourced live from posted GL activity and purchase
   * invoices tied to the project's cost center, same aggregation approach
   * as reports.service.ts#projectProfitability's costsToDate subquery.
   */
  async getCostBreakdown(companyId: string, projectId: string) {
    const project = await this.getOwned(companyId, projectId);

    const byAccount = await this.prisma.$queryRaw<Array<{ code: string; name: string; amount: Prisma.Decimal }>>`
      SELECT a."code", a."name", SUM(jel."debit" - jel."credit") AS "amount"
      FROM "journal_entry_lines" jel
      JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
      JOIN "accounts" a ON a."id" = jel."accountId"
      JOIN "account_classes" ac ON ac."id" = a."accountClassId"
      WHERE jel."costCenterId" = ${project.costCenterId} AND ac."code" = 'EXPENSE'
        AND je."status" IN ('POSTED','REVERSED')
      GROUP BY a."code", a."name"
      ORDER BY a."code"
    `;

    // Pending (unpaid) amount: distinct open/partially-paid purchase invoices
    // touching this project, deduped first — openAmount is invoice-level, and
    // a project can span multiple lines on one invoice, so a raw join-and-sum
    // would double count.
    const openInvoices = await this.prisma.$queryRaw<Array<{ id: string; openAmount: Prisma.Decimal }>>`
      SELECT DISTINCT pi."id", pi."openAmount"
      FROM "purchase_invoice_lines" pil
      JOIN "purchase_invoices" pi ON pi."id" = pil."purchaseInvoiceId"
      WHERE pil."projectId" = ${projectId} AND pi."status" IN ('POSTED','PARTIALLY_PAID')
    `;

    const totalCosts = byAccount.reduce((sum, row) => sum.add(new Prisma.Decimal(row.amount)), new Prisma.Decimal(0));
    const pendingAmount = openInvoices.reduce((sum, inv) => sum.add(new Prisma.Decimal(inv.openAmount)), new Prisma.Decimal(0));

    return {
      totalCosts: totalCosts.toFixed(2),
      pendingAmount: pendingAmount.toFixed(2),
      paidAmount: totalCosts.sub(pendingAmount).toFixed(2),
      byAccount: byAccount.map((row) => ({ code: row.code, name: row.name, amount: new Prisma.Decimal(row.amount).toFixed(2) })),
    };
  }

  // ── WBS tasks ────────────────────────────────────────────────────────

  async createTask(companyId: string, projectId: string, userId: string, dto: CreateWbsTaskDto) {
    const project = await this.getOwned(companyId, projectId);
    if (project.status === ProjectStatus.CLOSED) {
      throw new ConflictException("Closed projects cannot be modified");
    }
    if (dto.parentTaskId) {
      const parent = await this.prisma.wbsTask.findFirst({ where: { id: dto.parentTaskId, projectId } });
      if (!parent) {
        throw new BadRequestException("Parent task does not belong to this project");
      }
    }

    const task = await this.prisma.wbsTask.create({
      data: {
        projectId,
        companyId,
        parentTaskId: dto.parentTaskId,
        code: dto.code,
        name: dto.name,
        costBudget: new Prisma.Decimal(dto.costBudget ?? "0"),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditService.log({
      companyId,
      entityName: "WbsTask",
      entityId: task.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: task,
    });

    return task;
  }

  async updateTask(companyId: string, projectId: string, taskId: string, userId: string, dto: UpdateWbsTaskDto) {
    await this.getOwnedTask(companyId, projectId, taskId);
    const task = await this.prisma.wbsTask.update({
      where: { id: taskId },
      data: {
        name: dto.name,
        costBudget: dto.costBudget !== undefined ? new Prisma.Decimal(dto.costBudget) : undefined,
        sortOrder: dto.sortOrder,
      },
    });
    await this.auditService.log({
      companyId,
      entityName: "WbsTask",
      entityId: taskId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: task,
    });
    return task;
  }

  async deleteTask(companyId: string, projectId: string, taskId: string) {
    await this.getOwnedTask(companyId, projectId, taskId);
    const [children, jeRefs, salesRefs, purchaseRefs] = await Promise.all([
      this.prisma.wbsTask.count({ where: { parentTaskId: taskId } }),
      this.prisma.journalEntryLine.count({ where: { wbsTaskId: taskId } }),
      this.prisma.salesInvoiceLine.count({ where: { wbsTaskId: taskId } }),
      this.prisma.purchaseInvoiceLine.count({ where: { wbsTaskId: taskId } }),
    ]);
    if (children > 0) {
      throw new ConflictException("Task has child tasks — delete or reparent them first");
    }
    if (jeRefs + salesRefs + purchaseRefs > 0) {
      // Referenced tasks are audit-relevant history — deactivate instead.
      await this.prisma.wbsTask.update({ where: { id: taskId }, data: { isActive: false } });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.wbsTask.delete({ where: { id: taskId } });
    return { deleted: true };
  }

  // ── Department cost centers ──────────────────────────────────────────

  async listCostCenters(companyId: string) {
    return this.prisma.costCenter.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: { project: { select: { id: true, code: true, name: true } } },
    });
  }

  async createCostCenter(companyId: string, userId: string, code: string, name: string) {
    const clash = await this.prisma.costCenter.findFirst({ where: { companyId, code } });
    if (clash) {
      throw new ConflictException(`Cost center ${code} already exists`);
    }
    const costCenter = await this.prisma.costCenter.create({ data: { companyId, code, name } });
    await this.auditService.log({
      companyId,
      entityName: "CostCenter",
      entityId: costCenter.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: costCenter,
    });
    return costCenter;
  }

  async updateCostCenter(companyId: string, userId: string, costCenterId: string, dto: { code?: string; name?: string }) {
    const before = await this.prisma.costCenter.findFirst({ where: { id: costCenterId, companyId } });
    if (!before) {
      throw new NotFoundException("Cost center not found");
    }
    if (dto.code && dto.code !== before.code) {
      const clash = await this.prisma.costCenter.findFirst({ where: { companyId, code: dto.code, id: { not: costCenterId } } });
      if (clash) {
        throw new ConflictException(`Cost center ${dto.code} already exists`);
      }
    }
    const costCenter = await this.prisma.costCenter.update({
      where: { id: costCenterId },
      data: { code: dto.code, name: dto.name },
    });
    await this.auditService.log({
      companyId,
      entityName: "CostCenter",
      entityId: costCenter.id,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: costCenter,
    });
    return costCenter;
  }

  // ── Internals ────────────────────────────────────────────────────────

  async getOwned(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private async getOwnedTask(companyId: string, projectId: string, taskId: string) {
    const task = await this.prisma.wbsTask.findFirst({ where: { id: taskId, projectId, companyId } });
    if (!task) {
      throw new NotFoundException("WBS task not found");
    }
    return task;
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
