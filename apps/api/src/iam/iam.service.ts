import { Injectable, NotFoundException } from "@nestjs/common";
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
      companyUserId: m.id,
      userId: m.user.id,
      email: m.user.email,
      fullName: m.user.fullName,
      isActive: m.user.isActive,
      roleId: m.roleId,
      roleName: m.role.name,
      status: m.status,
    }));
  }

  /** Changes which role a company member carries — the admin-driven access-control lever. */
  async updateCompanyUserRole(companyId: string, companyUserId: string, roleId: string) {
    const companyUser = await this.prisma.companyUser.findFirst({ where: { id: companyUserId, companyId } });
    if (!companyUser) {
      throw new NotFoundException("User not found in this company");
    }
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) {
      throw new NotFoundException("Role not found in this company");
    }
    return this.prisma.companyUser.update({
      where: { id: companyUserId },
      data: { roleId },
      select: { id: true, roleId: true },
    });
  }
}
