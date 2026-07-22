import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class IamService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionsForCompanyUser(userId: string, companyId: string): Promise<string[]> {
    const companyUser = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    if (!companyUser) {
      return [];
    }
    return companyUser.role.rolePermissions.map((rp) => rp.permission.key);
  }

  async getCompanyMemberships(userId: string) {
    return this.prisma.companyUser.findMany({
      where: { userId },
      include: { company: true, role: true },
    });
  }

  /** Guards company-scoped admin actions (e.g. password reset) against cross-company user ids. */
  async isCompanyMember(userId: string, companyId: string): Promise<boolean> {
    const membership = await this.prisma.companyUser.findUnique({ where: { userId_companyId: { userId, companyId } } });
    return membership !== null;
  }

  /** Users belonging to a company, for the admin user-management screen. */
  async listCompanyUsers(companyId: string) {
    const memberships = await this.prisma.companyUser.findMany({
      where: { companyId },
      include: { user: { select: { id: true, email: true, fullName: true, isActive: true } }, role: { select: { name: true } } },
      orderBy: { user: { fullName: "asc" } },
    });
    return memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      fullName: m.user.fullName,
      isActive: m.user.isActive,
      roleName: m.role.name,
      status: m.status,
    }));
  }
}
