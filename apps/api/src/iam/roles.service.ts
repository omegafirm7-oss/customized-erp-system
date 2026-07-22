import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SYSTEM_ROLES } from "@erp/shared-constants";
import { PrismaService } from "../common/prisma/prisma.service";
import { DEFAULT_ROLE_PERMISSIONS } from "../seed-data/default-roles";

type TxClient = Prisma.TransactionClient;

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

  async listRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}
