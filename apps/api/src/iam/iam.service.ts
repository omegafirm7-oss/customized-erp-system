import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class IamService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionsForCompanyUser(userId: string, companyId: string): Promise<string[]> {
    const companyUser = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } }, user: { select: { isActive: true } } },
    });
    // Checked on every request (this is the live authorization source, not
    // just at login) — a suspended membership or deactivated user loses all
    // permissions immediately, even on an access token minted before the
    // suspension that hasn't expired yet.
    if (!companyUser || companyUser.status !== "ACTIVE" || !companyUser.user.isActive) {
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

  /**
   * Suspends or reactivates a user's access to this company. Suspending also
   * revokes every one of their refresh tokens — the access token they're
   * currently holding still works until its own ~15min expiry, but they can't
   * silently mint a new one, and any subsequent request that goes through
   * getPermissionsForCompanyUser() sees no permissions for a non-ACTIVE
   * membership. Re-activating simply flips status back; the role assignment
   * and everything else about the membership is left untouched, so access can
   * be restored exactly as it was.
   */
  async updateCompanyUserStatus(
    companyId: string,
    companyUserId: string,
    status: "ACTIVE" | "SUSPENDED",
    requestingUserId: string,
  ) {
    const companyUser = await this.prisma.companyUser.findFirst({ where: { id: companyUserId, companyId } });
    if (!companyUser) {
      throw new NotFoundException("User not found in this company");
    }
    if (companyUser.userId === requestingUserId && status === "SUSPENDED") {
      throw new BadRequestException("You cannot suspend your own access");
    }

    const updated = await this.prisma.companyUser.update({
      where: { id: companyUserId },
      data: { status },
      select: { id: true, userId: true, status: true },
    });

    if (status === "SUSPENDED") {
      await this.prisma.refreshToken.updateMany({
        where: { userId: updated.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  }

  /** Permanently removes a user's membership in this company (their account and any other company memberships are untouched). */
  async removeCompanyUser(companyId: string, companyUserId: string, requestingUserId: string) {
    const companyUser = await this.prisma.companyUser.findFirst({ where: { id: companyUserId, companyId } });
    if (!companyUser) {
      throw new NotFoundException("User not found in this company");
    }
    if (companyUser.userId === requestingUserId) {
      throw new BadRequestException("You cannot remove your own access");
    }

    await this.prisma.$transaction([
      this.prisma.companyUser.delete({ where: { id: companyUserId } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: companyUser.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { removed: true };
  }

  /**
   * Admin-driven user creation — bypasses the self-registration join-request
   * flow entirely. If the email already has an account elsewhere (e.g. they
   * already work at another company on this platform), it's reused as-is
   * (their existing password stays; only membership + role are added here).
   */
  async createCompanyUser(companyId: string, dto: { email: string; fullName: string; password: string; roleId: string }) {
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, companyId } });
    if (!role) {
      throw new NotFoundException("Role not found in this company");
    }

    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
      user = await this.prisma.user.create({ data: { email: dto.email, fullName: dto.fullName, passwordHash } });
    } else {
      const existingMembership = await this.prisma.companyUser.findUnique({
        where: { userId_companyId: { userId: user.id, companyId } },
      });
      if (existingMembership) {
        throw new ConflictException("This user already has access to this company");
      }
    }

    return this.prisma.companyUser.create({
      data: { userId: user.id, companyId, roleId: dto.roleId, status: "ACTIVE", joinedAt: new Date() },
      select: { id: true, userId: true, roleId: true, status: true },
    });
  }
}
