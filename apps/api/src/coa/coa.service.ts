import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ControlAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { DEFAULT_COA_TEMPLATE } from "../seed-data/default-coa";

type TxClient = Prisma.TransactionClient;

@Injectable()
export class CoaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clones DEFAULT_COA_TEMPLATE into company-specific Account rows. Must run
   * inside the same transaction as company creation (see companies.service.ts)
   * so a failure partway through never leaves a company with a half-built COA.
   */
  async cloneDefaultCoaForCompany(tx: TxClient, companyId: string): Promise<void> {
    const accountClasses = await tx.accountClass.findMany();
    const accountSubClasses = await tx.accountSubClass.findMany();
    const subClassById = new Map(accountSubClasses.map((sc) => [sc.code, sc]));
    const classById = new Map(accountClasses.map((c) => [c.id, c]));

    const codeToId = new Map<string, string>();

    for (const entry of DEFAULT_COA_TEMPLATE) {
      const subClass = subClassById.get(entry.subClassCode);
      if (!subClass) {
        throw new BadRequestException(`Unknown account sub-class code in COA template: ${entry.subClassCode}`);
      }
      const accountClass = classById.get(subClass.accountClassId);
      if (!accountClass) {
        throw new BadRequestException(`Account sub-class ${entry.subClassCode} has no parent class`);
      }
      const parentAccountId = entry.parentCode ? codeToId.get(entry.parentCode) : undefined;

      const created = await tx.account.create({
        data: {
          companyId,
          code: entry.code,
          name: entry.name,
          accountClassId: accountClass.id,
          accountSubClassId: subClass.id,
          parentAccountId: parentAccountId ?? null,
          isPostable: entry.isPostable,
          normalBalance: entry.normalBalance,
          controlAccountType: entry.controlAccountType ?? null,
        },
      });
      codeToId.set(entry.code, created.id);
    }
  }

  async listAccounts(companyId: string) {
    return this.prisma.account.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: { accountClass: true, accountSubClass: true },
    });
  }

  async getAccount(companyId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, companyId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }

  async createAccount(
    companyId: string,
    input: {
      code: string;
      name: string;
      nameAr?: string;
      accountSubClassCode: string;
      parentAccountId?: string;
      isPostable?: boolean;
      normalBalance: "DEBIT" | "CREDIT";
      // Prisma's enum type, so new control types never drift this union again
      controlAccountType?: ControlAccountType;
    },
  ) {
    const subClass = await this.prisma.accountSubClass.findUnique({ where: { code: input.accountSubClassCode } });
    if (!subClass) {
      throw new BadRequestException(`Unknown account sub-class code: ${input.accountSubClassCode}`);
    }
    return this.prisma.account.create({
      data: {
        companyId,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr,
        accountClassId: subClass.accountClassId,
        accountSubClassId: subClass.id,
        parentAccountId: input.parentAccountId ?? null,
        isPostable: input.isPostable ?? true,
        normalBalance: input.normalBalance,
        controlAccountType: input.controlAccountType ?? null,
      },
    });
  }

  async deactivateAccount(companyId: string, accountId: string) {
    const account = await this.getAccount(companyId, accountId);
    return this.prisma.account.update({ where: { id: account.id }, data: { isActive: false } });
  }

  async updateAccount(companyId: string, accountId: string, input: { name?: string; nameAr?: string }) {
    const account = await this.getAccount(companyId, accountId);
    return this.prisma.account.update({
      where: { id: account.id },
      data: { name: input.name, nameAr: input.nameAr },
    });
  }
}
