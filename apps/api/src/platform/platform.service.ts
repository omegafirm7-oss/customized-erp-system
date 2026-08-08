import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MODULE_KEYS } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";

const ORACLE_FREE_TIER_LIMIT_BYTES = 200 * 1024 * 1024 * 1024;
const VALID_MODULE_KEYS: string[] = Object.values(MODULE_KEYS);

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /** Storage attributable to each company's uploaded evidence, summed across
   * every attachment table (the only tables in the schema holding binary
   * data — see PurchaseInvoiceLineAttachment/TimesheetPeriodAttachment/
   * EmployeePaymentAttachment/UsageLogEntryAttachment/
   * ProjectEquipmentPeriodAttachment). Merged in JS since it's several small
   * groupBy calls, not worth a raw-SQL UNION. */
  private async storageByCompany(): Promise<Map<string, number>> {
    const [invoiceAttachments, timesheetAttachments, paymentAttachments, usageLogAttachments, projectEquipmentAttachments] =
      await Promise.all([
        this.prisma.purchaseInvoiceLineAttachment.groupBy({ by: ["companyId"], _sum: { size: true } }),
        this.prisma.timesheetPeriodAttachment.groupBy({ by: ["companyId"], _sum: { size: true } }),
        this.prisma.employeePaymentAttachment.groupBy({ by: ["companyId"], _sum: { size: true } }),
        this.prisma.usageLogEntryAttachment.groupBy({ by: ["companyId"], _sum: { size: true } }),
        this.prisma.projectEquipmentPeriodAttachment.groupBy({ by: ["companyId"], _sum: { size: true } }),
      ]);
    const byCompany = new Map<string, number>();
    for (const group of [
      ...invoiceAttachments,
      ...timesheetAttachments,
      ...paymentAttachments,
      ...usageLogAttachments,
      ...projectEquipmentAttachments,
    ]) {
      const prior = byCompany.get(group.companyId) ?? 0;
      byCompany.set(group.companyId, prior + (group._sum.size ?? 0));
    }
    return byCompany;
  }

  async listClients() {
    const [companies, userCounts, storageByCompany] = await Promise.all([
      this.prisma.company.findMany({
        select: {
          id: true,
          code: true,
          legalName: true,
          tradeName: true,
          isActive: true,
          createdAt: true,
          enabledModules: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.companyUser.groupBy({ by: ["companyId", "status"], _count: { _all: true } }),
      this.storageByCompany(),
    ]);

    const usersByCompany = new Map<string, { total: number; active: number }>();
    for (const group of userCounts) {
      const prior = usersByCompany.get(group.companyId) ?? { total: 0, active: 0 };
      prior.total += group._count._all;
      if (group.status === "ACTIVE") prior.active += group._count._all;
      usersByCompany.set(group.companyId, prior);
    }

    return companies.map((company) => ({
      id: company.id,
      code: company.code,
      legalName: company.legalName,
      tradeName: company.tradeName,
      isActive: company.isActive,
      createdAt: company.createdAt,
      userCount: usersByCompany.get(company.id)?.total ?? 0,
      activeUserCount: usersByCompany.get(company.id)?.active ?? 0,
      storageBytes: storageByCompany.get(company.id) ?? 0,
      enabledModules: company.enabledModules,
    }));
  }

  async updateClientModules(companyId: string, enabledModules: string[]) {
    const invalid = enabledModules.filter((key) => !VALID_MODULE_KEYS.includes(key));
    if (invalid.length > 0) {
      throw new BadRequestException(`Unknown module key(s): ${invalid.join(", ")}`);
    }
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException("Company not found");
    }
    return this.prisma.company.update({
      where: { id: companyId },
      data: { enabledModules: [...new Set(enabledModules)] },
      select: { id: true, enabledModules: true },
    });
  }

  async getSummary() {
    const [totalClients, activeClients, userCounts, storageByCompany] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { isActive: true } }),
      this.prisma.companyUser.groupBy({ by: ["status"], _count: { _all: true } }),
      this.storageByCompany(),
    ]);

    const totalUsers = userCounts.reduce((sum, g) => sum + g._count._all, 0);
    const activeUsers = userCounts.find((g) => g.status === "ACTIVE")?._count._all ?? 0;
    const totalStorageBytes = [...storageByCompany.values()].reduce((sum, v) => sum + v, 0);

    return {
      totalClients,
      activeClients,
      totalUsers,
      activeUsers,
      totalStorageBytes,
      storageLimitBytes: ORACLE_FREE_TIER_LIMIT_BYTES,
      storageUsedPercent: Math.round((totalStorageBytes / ORACLE_FREE_TIER_LIMIT_BYTES) * 1000) / 10,
    };
  }
}
