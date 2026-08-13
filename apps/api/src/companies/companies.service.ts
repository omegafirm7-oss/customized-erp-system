import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, FiscalPeriodStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CoaService } from "../coa/coa.service";
import { RolesService } from "../iam/roles.service";
import { AuditService } from "../audit/audit.service";
import { CreateCompanyDto } from "./dto/create-company.dto";

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coaService: CoaService,
    private readonly rolesService: RolesService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates a company and auto-provisions everything a new company needs to
   * be immediately usable: a cloned default COA, an open fiscal year with 12
   * monthly periods, a JOURNAL_ENTRY numbering series, the three default
   * roles, and membership for the creator as Administrator. All in one
   * transaction so a partial failure never leaves a half-provisioned company.
   */
  async createCompany(dto: CreateCompanyDto, creatorUserId: string) {
    const existing = await this.prisma.company.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Company code "${dto.code}" is already in use`);
    }

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          code: dto.code,
          legalName: dto.legalName,
          tradeName: dto.tradeName,
          countryCode: dto.countryCode.toUpperCase(),
          baseCurrencyCode: dto.baseCurrency.toUpperCase(),
          taxRegistrationNumber: dto.taxRegistrationNumber,
          crNumber: dto.crNumber,
        },
      });

      await this.coaService.cloneDefaultCoaForCompany(tx, created.id);

      const now = new Date();
      const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));
      const fiscalYear = await tx.fiscalYear.create({
        data: {
          companyId: created.id,
          code: `FY${now.getUTCFullYear()}`,
          startDate: yearStart,
          endDate: yearEnd,
        },
      });

      await tx.fiscalPeriod.createMany({
        data: Array.from({ length: 12 }, (_, month) => ({
          fiscalYearId: fiscalYear.id,
          companyId: created.id,
          periodNumber: month + 1,
          startDate: new Date(Date.UTC(now.getUTCFullYear(), month, 1)),
          endDate: new Date(Date.UTC(now.getUTCFullYear(), month + 1, 0, 23, 59, 59)),
          status: FiscalPeriodStatus.OPEN,
        })),
      });

      const seriesDefs: Array<{ documentType: DocumentType; prefix: string }> = [
        { documentType: DocumentType.JOURNAL_ENTRY, prefix: "JE-" },
        { documentType: DocumentType.SALES_INVOICE, prefix: "INV-" },
        { documentType: DocumentType.CREDIT_NOTE, prefix: "CN-" },
        { documentType: DocumentType.PURCHASE_INVOICE, prefix: "PINV-" },
        { documentType: DocumentType.PURCHASE_REQUISITION, prefix: "PR-" },
        { documentType: DocumentType.PURCHASE_QUOTATION, prefix: "PQ-" },
        { documentType: DocumentType.PURCHASE_ORDER, prefix: "PO-" },
        { documentType: DocumentType.GOODS_RECEIPT, prefix: "GRN-" },
        { documentType: DocumentType.SALES_QUOTATION, prefix: "SQ-" },
        { documentType: DocumentType.SALES_ORDER, prefix: "SO-" },
        { documentType: DocumentType.INCOMING_PAYMENT, prefix: "RCT-" },
        { documentType: DocumentType.OUTGOING_PAYMENT, prefix: "PAY-" },
        { documentType: DocumentType.STOCK_TRANSFER, prefix: "ST-" },
        { documentType: DocumentType.STOCK_ADJUSTMENT, prefix: "ADJ-" },
        // "PAY-" belongs to OUTGOING_PAYMENT, hence "PYR-" for payroll runs
        { documentType: DocumentType.PAYROLL_RUN, prefix: "PYR-" },
        { documentType: DocumentType.EMPLOYEE_LOAN, prefix: "LOAN-" },
        { documentType: DocumentType.FINAL_SETTLEMENT, prefix: "FS-" },
        { documentType: DocumentType.DEPRECIATION_RUN, prefix: "DEPR-" },
        { documentType: DocumentType.EMPLOYEE_PAYMENT, prefix: "EPY-" },
      ];
      await tx.numberingSeries.createMany({
        data: seriesDefs.map((def) => ({
          companyId: created.id,
          documentType: def.documentType,
          prefix: def.prefix,
          nextNumber: 1,
          numberLength: 6,
          fiscalYearId: null,
        })),
      });

      await tx.warehouse.create({
        data: { companyId: created.id, code: "MAIN", name: "Main Warehouse", isDefault: true },
      });

      // Statutory payroll defaults live in the schema; the row just needs to exist.
      await tx.hrSettings.create({ data: { companyId: created.id } });

      const { administratorRoleId } = await this.rolesService.seedDefaultRolesForCompany(tx, created.id);

      const existingMemberships = await tx.companyUser.count({ where: { userId: creatorUserId } });
      await tx.companyUser.create({
        data: {
          userId: creatorUserId,
          companyId: created.id,
          roleId: administratorRoleId,
          isDefault: existingMemberships === 0,
          joinedAt: new Date(),
        },
      });

      return created;
    }, { timeout: 20000 });

    await this.auditService.log({
      companyId: company.id,
      entityName: "Company",
      entityId: company.id,
      action: "CREATE",
      changedByUserId: creatorUserId,
      afterSnapshot: company,
    });

    return company;
  }

  async getCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException("Company not found");
    }
    return company;
  }

  async updateCompany(companyId: string, userId: string, data: Record<string, unknown>) {
    const before = await this.getCompany(companyId);
    const updated = await this.prisma.company.update({ where: { id: companyId }, data });
    await this.auditService.log({
      companyId,
      entityName: "Company",
      entityId: companyId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  async listFiscalPeriods(companyId: string) {
    return this.prisma.fiscalPeriod.findMany({
      where: { companyId },
      orderBy: [{ fiscalYearId: "asc" }, { periodNumber: "asc" }],
    });
  }

  async closeFiscalPeriod(companyId: string, periodId: string, closedByUserId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id: periodId, companyId } });
    if (!period) {
      throw new NotFoundException("Fiscal period not found");
    }
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException("Fiscal period is already closed");
    }

    const updated = await this.prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: { status: FiscalPeriodStatus.CLOSED },
    });

    await this.auditService.log({
      companyId,
      entityName: "FiscalPeriod",
      entityId: period.id,
      action: "CLOSE",
      changedByUserId: closedByUserId,
      beforeSnapshot: period,
      afterSnapshot: updated,
    });

    return updated;
  }
}
