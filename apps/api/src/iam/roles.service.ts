import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SYSTEM_ROLES } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";
import { DEFAULT_ROLE_PERMISSIONS } from "../seed-data/default-roles";

type TxClient = Prisma.TransactionClient;

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the three default company-scoped roles (Administrator,
   * Accountant, Viewer) for a newly created company, wired to the global
   * Permission catalog seeded by prisma/seed.ts. Returns the Administrator
   * role id so the company creator can be assigned to it immediately.
   *
   * Must run inside the same transaction as company creation (see
   * companies.service.ts) — the company row it references by companyId
   * only exists within that uncommitted transaction, so a separate
   * connection (e.g. the injected PrismaService) can't see it yet and
   * would fail with a foreign-key violation.
   */
  async seedDefaultRolesForCompany(tx: TxClient, companyId: string): Promise<{ administratorRoleId: string }> {
    const allPermissions = await tx.permission.findMany();
    const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    let administratorRoleId = "";

    for (const [roleName, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const role = await tx.role.create({
        data: {
          companyId,
          name: roleName,
          isSystem: true,
          rolePermissions: {
            create: permissionKeys
              .filter((key) => permissionIdByKey.has(key))
              .map((key) => ({ permissionId: permissionIdByKey.get(key) as string })),
          },
        },
      });
      if (roleName === SYSTEM_ROLES.ADMINISTRATOR) {
        administratorRoleId = role.id;
      }
    }

    return { administratorRoleId };
  }

  /**
   * Includes each role's granted permission keys and how many users currently
   * carry it, so the admin UI can show/edit custom roles and know whether a
   * role is safe to delete. Backward compatible with callers (e.g. the join-
   * request approval dropdown) that only read `id`/`name`.
   */
  async listRoles(companyId: string) {
    const roles = await this.prisma.role.findMany({
      where: { companyId },
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { companyUsers: true } },
      },
      orderBy: { name: "asc" },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      permissionKeys: r.rolePermissions.map((rp) => rp.permission.key),
      userCount: r._count.companyUsers,
    }));
  }

  /** Full permission catalog (key + module), for the role-editor checkbox grid. */
  async getPermissionCatalog() {
    const permissions = await this.prisma.permission.findMany({
      select: { key: true, module: true },
      orderBy: [{ module: "asc" }, { key: "asc" }],
    });
    return permissions;
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const found = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    return found.map((p) => p.id);
  }

  private async getRoleDetail(roleId: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { rolePermissions: { select: { permission: { select: { key: true } } } } },
    });
    return {
      id: role.id,
      name: role.name,
      isSystem: role.isSystem,
      permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
    };
  }

  async createRole(companyId: string, name: string, permissionKeys: string[]) {
    const permissionIds = await this.resolvePermissionIds(permissionKeys);
    try {
      const role = await this.prisma.role.create({
        data: {
          companyId,
          name,
          isSystem: false,
          rolePermissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
      });
      return this.getRoleDetail(role.id);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException("A role with this name already exists");
      }
      throw err;
    }
  }

  async updateRole(companyId: string, roleId: string, dto: { name?: string; permissionKeys?: string[] }) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) {
      throw new NotFoundException("Role not found");
    }
    if (role.isSystem) {
      throw new ForbiddenException("System roles cannot be edited — create a custom role instead");
    }

    if (dto.name !== undefined) {
      try {
        await this.prisma.role.update({ where: { id: roleId }, data: { name: dto.name } });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new ConflictException("A role with this name already exists");
        }
        throw err;
      }
    }

    if (dto.permissionKeys !== undefined) {
      const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);
      await this.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) });
        }
      });
    }

    return this.getRoleDetail(roleId);
  }

  async deleteRole(companyId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, companyId },
      include: { _count: { select: { companyUsers: true, joinRequests: true } } },
    });
    if (!role) {
      throw new NotFoundException("Role not found");
    }
    if (role.isSystem) {
      throw new ForbiddenException("System roles cannot be deleted");
    }
    if (role._count.companyUsers > 0 || role._count.joinRequests > 0) {
      throw new ConflictException("This role is still assigned to users or pending join requests — reassign them first");
    }
    await this.prisma.role.delete({ where: { id: roleId } });
  }
}
