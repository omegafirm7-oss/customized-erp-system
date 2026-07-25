import { BadRequestException, Injectable } from "@nestjs/common";
import { ControlAccountType, Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

/**
 * Resolves the single control account a posting must hit for a given role
 * (AR, AP, VAT_OUTPUT, VAT_INPUT, ...). The company's COA is expected to
 * carry exactly one active, postable account per control type — enforced
 * here with clear errors rather than silently picking one.
 */
@Injectable()
export class AccountResolutionService {
  async getControlAccount(tx: TxClient, companyId: string, type: ControlAccountType) {
    const accounts = await tx.account.findMany({
      where: { companyId, controlAccountType: type, isActive: true, isPostable: true },
    });
    if (accounts.length === 0) {
      throw new BadRequestException(
        `No active postable ${type} control account is configured in this company's chart of accounts`,
      );
    }
    if (accounts.length > 1) {
      throw new BadRequestException(
        `Multiple ${type} control accounts found (${accounts.map((a) => a.code).join(", ")}); exactly one must be active`,
      );
    }
    return accounts[0];
  }

  /** Validates that the given account is a BANK or CASH control account of this company. */
  async getBankOrCashAccount(tx: TxClient, companyId: string, accountId: string) {
    const account = await tx.account.findFirst({
      where: { id: accountId, companyId, isActive: true, isPostable: true },
    });
    if (!account) {
      throw new BadRequestException("Bank/cash account not found in this company");
    }
    if (account.controlAccountType !== ControlAccountType.BANK && account.controlAccountType !== ControlAccountType.CASH) {
      throw new BadRequestException(`Account ${account.code} is not a bank or cash account`);
    }
    return account;
  }

  /** Validates that the given account is a postable EXPENSE-class account of this company. */
  async getExpenseAccount(tx: TxClient, companyId: string, accountId: string) {
    const account = await tx.account.findFirst({
      where: { id: accountId, companyId, isActive: true, isPostable: true },
      include: { accountClass: true },
    });
    if (!account) {
      throw new BadRequestException("Expense account not found in this company");
    }
    if (account.accountClass.code !== "EXPENSE") {
      throw new BadRequestException(`Account ${account.code} is not an expense account`);
    }
    return account;
  }
}
