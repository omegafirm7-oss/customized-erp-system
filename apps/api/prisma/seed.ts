import { PrismaClient } from "@prisma/client";
import { ACCOUNT_CLASSES, ACCOUNT_SUB_CLASSES } from "../src/seed-data/account-classes";
import { DEFAULT_CURRENCIES } from "../src/seed-data/default-currencies";
import { DEFAULT_PERMISSIONS } from "../src/seed-data/default-permissions";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/seed-data/default-roles";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding global catalog data (currencies, account classes, permissions)...");

  for (const currency of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { name: currency.name, decimalPlaces: currency.decimalPlaces },
      create: currency,
    });
  }

  for (const accountClass of ACCOUNT_CLASSES) {
    await prisma.accountClass.upsert({
      where: { code: accountClass.code },
      update: { name: accountClass.name },
      create: accountClass,
    });
  }

  for (const subClass of ACCOUNT_SUB_CLASSES) {
    const parentClass = await prisma.accountClass.findUniqueOrThrow({ where: { code: subClass.classCode } });
    await prisma.accountSubClass.upsert({
      where: { code: subClass.code },
      update: {
        name: subClass.name,
        isCurrent: subClass.isCurrent,
        ifrs18Category: subClass.ifrs18Category,
        sortOrder: subClass.sortOrder,
      },
      create: {
        code: subClass.code,
        name: subClass.name,
        isCurrent: subClass.isCurrent,
        ifrs18Category: subClass.ifrs18Category,
        sortOrder: subClass.sortOrder,
        accountClassId: parentClass.id,
      },
    });
  }

  // IFRS 18: account 4950 (Gain/Loss on Asset Disposal) moves from the generic
  // OTHER_INCOME sub-class into the new INVESTING_INCOME sub-class so it's
  // correctly categorized on the Statement of Profit or Loss. New companies
  // get this from default-coa.ts directly; this backfills existing ones.
  const investingIncomeSubClass = await prisma.accountSubClass.findUnique({ where: { code: "INVESTING_INCOME" } });
  if (investingIncomeSubClass) {
    await prisma.account.updateMany({
      where: { code: "4950" },
      data: { accountSubClassId: investingIncomeSubClass.id },
    });
  }

  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { module: permission.module },
      create: permission,
    });
  }

  // Grant any newly introduced permission keys to existing companies' system
  // roles, per the same role→permission mapping used when provisioning a new
  // company. Idempotent: skipDuplicates makes re-runs a no-op.
  console.log("Backfilling system-role permission grants for existing companies...");
  const allPermissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  for (const [roleName, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const roles = await prisma.role.findMany({ where: { name: roleName, isSystem: true } });
    const grants = roles.flatMap((role) =>
      permissionKeys
        .filter((key) => permissionIdByKey.has(key))
        .map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key) as string })),
    );
    if (grants.length > 0) {
      await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
    }
  }

  console.log("Global catalog seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
