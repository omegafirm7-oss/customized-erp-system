import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentType, FiscalPeriodStatus, JournalEntryStatus, JournalSourceModule, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NumberingService } from "../numbering/numbering.service";
import { AuditService } from "../audit/audit.service";
import { CreateJournalEntryDto } from "./dto/create-journal-entry.dto";

type TxClient = Prisma.TransactionClient;

export interface PostedEntryLineInput {
  accountId: string;
  /** Functional-currency debit; zero if this is a credit line. */
  debit: Prisma.Decimal;
  /** Functional-currency credit; zero if this is a debit line. */
  credit: Prisma.Decimal;
  /** Transaction-currency amount for the line (absolute). */
  amountInTransactionCurrency: Prisma.Decimal;
  description?: string | null;
  businessPartnerId?: string | null;
  costCenterId?: string | null;
  wbsTaskId?: string | null;
}

export interface CreatePostedEntryParams {
  companyId: string;
  userId: string;
  postingDate: Date;
  documentDate: Date;
  currencyCode: string;
  exchangeRateToFunctional: Prisma.Decimal;
  sourceModule: JournalSourceModule;
  sourceDocumentId: string;
  memo?: string | null;
  allowSoftClosedOverride?: boolean;
  lines: PostedEntryLineInput[];
}

/**
 * The transactional posting engine for the General Ledger. This is the
 * single most compliance-critical piece of code in the system: it is the
 * only place debit=credit balance, account postability, and fiscal-period
 * locking are enforced before a journal entry becomes part of permanent
 * ledger history. See prisma/sql/gl-constraints.sql for the DB-level
 * defense-in-depth backing these same invariants.
 */
@Injectable()
export class GlPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  async createDraft(companyId: string, userId: string, dto: CreateJournalEntryDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const currencyCode = (dto.currencyCode ?? company.baseCurrencyCode).toUpperCase();
    const postingDate = new Date(dto.postingDate);
    const documentDate = new Date(dto.documentDate);

    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { companyId, startDate: { lte: postingDate }, endDate: { gte: postingDate } },
    });
    if (!period) {
      throw new BadRequestException("No fiscal period covers the posting date");
    }

    const exchangeRate = await this.resolveExchangeRate(
      companyId,
      currencyCode,
      company.baseCurrencyCode,
      postingDate,
    );

    await this.validateAccountsBelongToCompany(
      companyId,
      dto.lines.map((l) => l.accountId),
    );

    // Project-dimension sugar: projectId resolves to the project's cost
    // center; a conflicting explicit costCenterId is rejected. Task must
    // belong to the line's project.
    const projectIds = [...new Set(dto.lines.map((l) => l.projectId).filter((id): id is string => !!id))];
    const projects = await this.prisma.project.findMany({ where: { id: { in: projectIds }, companyId } });
    const projectById = new Map(projects.map((p) => [p.id, p]));
    if (projects.length !== projectIds.length) {
      throw new BadRequestException("One or more projects are invalid for this company");
    }
    const taskIds = [...new Set(dto.lines.map((l) => l.wbsTaskId).filter((id): id is string => !!id))];
    const tasks = await this.prisma.wbsTask.findMany({ where: { id: { in: taskIds }, companyId } });
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    if (tasks.length !== taskIds.length) {
      throw new BadRequestException("One or more WBS tasks are invalid for this company");
    }

    const lineData = dto.lines.map((line, index) => {
      const debit = new Prisma.Decimal(line.debit || "0");
      const credit = new Prisma.Decimal(line.credit || "0");
      if (debit.gt(0) && credit.gt(0)) {
        throw new BadRequestException(`Line ${index + 1}: cannot have both a debit and a credit amount`);
      }
      if (debit.eq(0) && credit.eq(0)) {
        throw new BadRequestException(`Line ${index + 1}: must have a non-zero debit or credit amount`);
      }
      const transactionAmount = debit.gt(0) ? debit : credit;
      const functionalAmount = transactionAmount.mul(exchangeRate);

      const project = line.projectId ? projectById.get(line.projectId) : undefined;
      let costCenterId = line.costCenterId ?? null;
      if (project) {
        if (costCenterId && costCenterId !== project.costCenterId) {
          throw new BadRequestException(`Line ${index + 1}: costCenterId conflicts with the project's cost center`);
        }
        costCenterId = project.costCenterId;
      }
      if (line.wbsTaskId) {
        const task = taskById.get(line.wbsTaskId);
        if (!task || !line.projectId || task.projectId !== line.projectId) {
          throw new BadRequestException(`Line ${index + 1}: WBS task does not belong to the line's project`);
        }
      }

      return {
        lineNumber: index + 1,
        accountId: line.accountId,
        debit: debit.gt(0) ? functionalAmount : new Prisma.Decimal(0),
        credit: credit.gt(0) ? functionalAmount : new Prisma.Decimal(0),
        description: line.description,
        businessPartnerId: line.businessPartnerId,
        costCenterId,
        wbsTaskId: line.wbsTaskId ?? null,
        currencyCode,
        amountInTransactionCurrency: transactionAmount,
        amountInFunctionalCurrency: functionalAmount,
        companyId,
      };
    });

    return this.prisma.journalEntry.create({
      data: {
        companyId,
        fiscalYearId: period.fiscalYearId,
        fiscalPeriodId: period.id,
        postingDate,
        documentDate,
        currencyCode,
        exchangeRateToFunctional: exchangeRate,
        status: JournalEntryStatus.DRAFT,
        sourceModule: "MANUAL",
        memo: dto.memo,
        createdByUserId: userId,
        lines: { create: lineData },
      },
      include: { lines: { include: { account: true } } },
    });
  }

  async postEntry(companyId: string, entryId: string, userId: string, allowSoftClosedOverride: boolean) {
    const before = await this.getOwnedEntry(companyId, entryId);
    if (before.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException("Only draft entries can be posted");
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { lines: true },
      });

      const totalDebit = entry.lines.reduce((sum, l) => sum.add(l.debit), new Prisma.Decimal(0));
      const totalCredit = entry.lines.reduce((sum, l) => sum.add(l.credit), new Prisma.Decimal(0));
      if (!totalDebit.eq(totalCredit)) {
        throw new BadRequestException(`Entry is not balanced: debit ${totalDebit.toString()} != credit ${totalCredit.toString()}`);
      }

      const accountIds = [...new Set(entry.lines.map((l) => l.accountId))];
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, companyId } });
      if (accounts.length !== accountIds.length) {
        throw new BadRequestException("One or more accounts no longer exist for this company");
      }
      for (const account of accounts) {
        if (!account.isPostable) {
          throw new BadRequestException(`Account ${account.code} is not postable (it is a header/group account)`);
        }
        if (!account.isActive) {
          throw new BadRequestException(`Account ${account.code} is inactive`);
        }
      }

      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: entry.fiscalPeriodId } });
      if (period.status === FiscalPeriodStatus.CLOSED) {
        throw new ConflictException("Cannot post into a closed fiscal period");
      }
      if (period.status === FiscalPeriodStatus.SOFT_CLOSED && !allowSoftClosedOverride) {
        throw new ForbiddenException("This period is soft-closed; posting requires the period override permission");
      }

      const entryNumber = await this.numberingService.allocate(tx, {
        companyId,
        documentType: DocumentType.JOURNAL_ENTRY,
        fiscalYearId: null,
      });

      return tx.journalEntry.update({
        where: { id: entryId },
        data: { status: JournalEntryStatus.POSTED, entryNumber, postedByUserId: userId, postedAt: new Date() },
        include: { lines: { include: { account: true } } },
      });
    });

    await this.auditService.log({
      companyId,
      entityName: "JournalEntry",
      entityId: posted.id,
      action: "POST",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: posted,
    });

    return posted;
  }

  /**
   * Creates a journal entry directly in POSTED status inside the caller's
   * transaction. This is the single entry point for document-driven postings
   * (AR/AP invoices, payments): the caller composes the lines and passes the
   * same `tx` it uses for the document write, so document + JE + number
   * allocation commit or roll back as one unit. Enforces the same invariants
   * as postEntry (balance, postable accounts, period status).
   */
  async createPostedEntry(tx: TxClient, params: CreatePostedEntryParams) {
    const zero = new Prisma.Decimal(0);
    const totalDebit = params.lines.reduce((sum, l) => sum.add(l.debit), zero);
    const totalCredit = params.lines.reduce((sum, l) => sum.add(l.credit), zero);
    if (!totalDebit.eq(totalCredit)) {
      throw new BadRequestException(
        `Posting is not balanced: debit ${totalDebit.toString()} != credit ${totalCredit.toString()}`,
      );
    }
    for (const [index, line] of params.lines.entries()) {
      if (line.debit.gt(0) && line.credit.gt(0)) {
        throw new BadRequestException(`Line ${index + 1}: cannot have both a debit and a credit amount`);
      }
      if (line.debit.eq(0) && line.credit.eq(0)) {
        throw new BadRequestException(`Line ${index + 1}: must have a non-zero debit or credit amount`);
      }
    }

    const accountIds = [...new Set(params.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, companyId: params.companyId } });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException("One or more accounts are invalid for this company");
    }
    for (const account of accounts) {
      if (!account.isPostable) {
        throw new BadRequestException(`Account ${account.code} is not postable (it is a header/group account)`);
      }
      if (!account.isActive) {
        throw new BadRequestException(`Account ${account.code} is inactive`);
      }
    }

    const period = await tx.fiscalPeriod.findFirst({
      where: { companyId: params.companyId, startDate: { lte: params.postingDate }, endDate: { gte: params.postingDate } },
    });
    if (!period) {
      throw new BadRequestException("No fiscal period covers the posting date");
    }
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException("Cannot post into a closed fiscal period");
    }
    if (period.status === FiscalPeriodStatus.SOFT_CLOSED && !params.allowSoftClosedOverride) {
      throw new ForbiddenException("This period is soft-closed; posting requires the period override permission");
    }

    const entryNumber = await this.numberingService.allocate(tx, {
      companyId: params.companyId,
      documentType: DocumentType.JOURNAL_ENTRY,
      fiscalYearId: null,
    });

    const now = new Date();
    return tx.journalEntry.create({
      data: {
        companyId: params.companyId,
        entryNumber,
        fiscalYearId: period.fiscalYearId,
        fiscalPeriodId: period.id,
        postingDate: params.postingDate,
        documentDate: params.documentDate,
        currencyCode: params.currencyCode,
        exchangeRateToFunctional: params.exchangeRateToFunctional,
        status: JournalEntryStatus.POSTED,
        sourceModule: params.sourceModule,
        sourceDocumentId: params.sourceDocumentId,
        memo: params.memo,
        createdByUserId: params.userId,
        postedByUserId: params.userId,
        postedAt: now,
        lines: {
          create: params.lines.map((line, index) => ({
            lineNumber: index + 1,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description ?? null,
            businessPartnerId: line.businessPartnerId ?? null,
            costCenterId: line.costCenterId ?? null,
            wbsTaskId: line.wbsTaskId ?? null,
            currencyCode: params.currencyCode,
            amountInTransactionCurrency: line.amountInTransactionCurrency,
            amountInFunctionalCurrency: line.debit.gt(0) ? line.debit : line.credit,
            companyId: params.companyId,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /**
   * Transaction-aware reversal core. Callers that reverse a JE as part of a
   * larger business transaction (invoice/payment cancellation) pass their own
   * `tx`; the standalone reverseEntry endpoint wraps this in its own
   * transaction.
   */
  async reverseEntryInTx(tx: TxClient, companyId: string, entryId: string, userId: string, postingDate?: Date) {
    const original = await tx.journalEntry.findFirst({
      where: { id: entryId, companyId },
      include: { lines: true },
    });
    if (!original) {
      throw new NotFoundException("Journal entry not found");
    }
    if (original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException("Only posted entries can be reversed");
    }

    // Default: reverse into today's period. Callers whose downstream math is
    // as-of-period-end (revenue recognition) pass the original period date so
    // the reversal lands in the same period it corrects.
    const now = postingDate ?? new Date();
    const period = await tx.fiscalPeriod.findFirst({
      where: { companyId, startDate: { lte: now }, endDate: { gte: now } },
    });
    if (!period) {
      throw new BadRequestException("No fiscal period covers today's date for the reversal");
    }
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException("Cannot post the reversal into a closed fiscal period");
    }

    const entryNumber = await this.numberingService.allocate(tx, {
      companyId,
      documentType: DocumentType.JOURNAL_ENTRY,
      fiscalYearId: null,
    });

    const reversalEntry = await tx.journalEntry.create({
      data: {
        companyId,
        entryNumber,
        fiscalYearId: period.fiscalYearId,
        fiscalPeriodId: period.id,
        postingDate: now,
        documentDate: now,
        currencyCode: original.currencyCode,
        exchangeRateToFunctional: original.exchangeRateToFunctional,
        status: JournalEntryStatus.POSTED,
        sourceModule: original.sourceModule,
        reversalOfEntryId: original.id,
        memo: `Reversal of ${original.entryNumber ?? original.id}`,
        createdByUserId: userId,
        postedByUserId: userId,
        postedAt: now,
        lines: {
          create: original.lines.map((line, index) => ({
            lineNumber: index + 1,
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            description: line.description,
            businessPartnerId: line.businessPartnerId,
            costCenterId: line.costCenterId,
            wbsTaskId: line.wbsTaskId,
            currencyCode: line.currencyCode,
            amountInTransactionCurrency: line.amountInTransactionCurrency,
            amountInFunctionalCurrency: line.amountInFunctionalCurrency,
            companyId,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: JournalEntryStatus.REVERSED },
    });

    return reversalEntry;
  }

  async reverseEntry(companyId: string, entryId: string, userId: string) {
    const original = await this.getOwnedEntry(companyId, entryId);
    if (original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException("Only posted entries can be reversed");
    }

    const reversed = await this.prisma.$transaction((tx) => this.reverseEntryInTx(tx, companyId, entryId, userId));

    await this.auditService.log({
      companyId,
      entityName: "JournalEntry",
      entityId: original.id,
      action: "REVERSE",
      changedByUserId: userId,
      beforeSnapshot: original,
      afterSnapshot: reversed,
    });

    return reversed;
  }

  async listEntries(companyId: string, status?: JournalEntryStatus) {
    return this.prisma.journalEntry.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { lines: { include: { account: true } } },
    });
  }

  async getEntry(companyId: string, entryId: string) {
    return this.getOwnedEntry(companyId, entryId);
  }

  private async getOwnedEntry(companyId: string, entryId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, companyId },
      include: { lines: { include: { account: true } } },
    });
    if (!entry) {
      throw new NotFoundException("Journal entry not found");
    }
    return entry;
  }

  private async validateAccountsBelongToCompany(companyId: string, accountIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(accountIds)];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: uniqueIds }, companyId } });
    if (accounts.length !== uniqueIds.length) {
      throw new BadRequestException("One or more accounts are invalid for this company");
    }
  }

  private async resolveExchangeRate(
    companyId: string,
    currencyCode: string,
    baseCurrencyCode: string,
    rateDate: Date,
  ): Promise<Prisma.Decimal> {
    if (currencyCode === baseCurrencyCode) {
      return new Prisma.Decimal(1);
    }
    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        companyId,
        fromCurrencyCode: currencyCode,
        toCurrencyCode: baseCurrencyCode,
        rateDate: { lte: rateDate },
      },
      orderBy: { rateDate: "desc" },
    });
    if (!rate) {
      throw new BadRequestException(
        `No exchange rate found from ${currencyCode} to ${baseCurrencyCode} on or before ${rateDate.toISOString()}`,
      );
    }
    return rate.rate;
  }
}
