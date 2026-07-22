import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  ControlAccountType,
  FiscalPeriodStatus,
  JournalSourceModule,
  Prisma,
  ProjectStatus,
  RecognitionMethod,
  RevenueRecognitionRunStatus,
} from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AuditService } from "../audit/audit.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { computeRevRec } from "./revrec-math";

type TxClient = Prisma.TransactionClient;

@Injectable()
export class RevenueRecognitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly glPostingService: GlPostingService,
    private readonly accountResolution: AccountResolutionService,
    private readonly auditService: AuditService,
  ) {}

  async runForPeriod(companyId: string, projectId: string, fiscalPeriodId: string, userId: string, allowSoftClosedOverride = false) {
    const run = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, companyId },
        include: { costCenter: true },
      });
      if (!project) {
        throw new NotFoundException("Project not found");
      }
      if (project.recognitionMethod !== RecognitionMethod.OVER_TIME) {
        throw new BadRequestException("Revenue recognition runs apply only to OVER_TIME projects");
      }
      if (project.status !== ProjectStatus.ACTIVE && project.status !== ProjectStatus.COMPLETED) {
        throw new ConflictException(`Project must be ACTIVE or COMPLETED (is ${project.status})`);
      }
      if (project.estimatedTotalCost.lte(0)) {
        throw new BadRequestException("estimatedTotalCost must be set before running revenue recognition");
      }
      if (project.contractValue.lte(0)) {
        throw new BadRequestException("contractValue must be set before running revenue recognition");
      }

      const period = await tx.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
      if (!period) {
        throw new NotFoundException("Fiscal period not found");
      }
      if (period.status === FiscalPeriodStatus.CLOSED) {
        throw new ConflictException("Cannot run revenue recognition into a closed period");
      }
      if (period.status === FiscalPeriodStatus.SOFT_CLOSED && !allowSoftClosedOverride) {
        throw new ConflictException("Period is soft-closed; requires the period override permission");
      }

      const existingPosted = await tx.revenueRecognitionRun.findFirst({
        where: { projectId, fiscalPeriodId, status: RevenueRecognitionRunStatus.POSTED },
      });
      if (existingPosted) {
        throw new ConflictException("A posted run already exists for this period — reverse it first");
      }
      // Cumulative math forbids out-of-order runs.
      const laterRun = await tx.revenueRecognitionRun.findFirst({
        where: {
          projectId,
          status: RevenueRecognitionRunStatus.POSTED,
          fiscalPeriod: { startDate: { gt: period.endDate } },
        },
      });
      if (laterRun) {
        throw new ConflictException("A posted run exists for a later period — runs must be sequential");
      }

      // Balances as of period END (not "now"): late-posted prior-period
      // documents are picked up; future-period documents are excluded.
      const costsToDate = await this.sumByCostCenter(tx, companyId, project.costCenterId, period.endDate, "EXPENSE_CLASS");
      const contractAssetBal = await this.sumByCostCenter(tx, companyId, project.costCenterId, period.endDate, ControlAccountType.CONTRACT_ASSET);
      const contractLiabilityBal = (
        await this.sumByCostCenter(tx, companyId, project.costCenterId, period.endDate, ControlAccountType.CONTRACT_LIABILITY)
      ).neg();
      const previouslyRecognized = (
        await this.sumByCostCenter(tx, companyId, project.costCenterId, period.endDate, ControlAccountType.CONTRACT_REVENUE)
      ).neg();

      const result = computeRevRec({
        costsToDate,
        estimatedTotalCost: project.estimatedTotalCost,
        contractValue: project.contractValue,
        contractAssetBalance: contractAssetBal,
        contractLiabilityBalance: contractLiabilityBal,
        previouslyRecognized,
      });

      if (result.revenueDelta.eq(0) && result.contractAssetDelta.eq(0) && result.contractLiabilityDelta.eq(0)) {
        throw new BadRequestException("Nothing to recognize for this period (no change since the last run)");
      }

      const assetAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.CONTRACT_ASSET);
      const liabilityAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.CONTRACT_LIABILITY);
      const revenueAccount = await this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.CONTRACT_REVENUE);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });

      const zero = new Prisma.Decimal(0);
      const glLines: PostedEntryLineInput[] = [];
      const pushDelta = (accountId: string, delta: Prisma.Decimal, description: string) => {
        if (delta.eq(0)) return;
        glLines.push({
          accountId,
          debit: delta.gt(0) ? delta : zero,
          credit: delta.lt(0) ? delta.neg() : zero,
          amountInTransactionCurrency: delta.abs(),
          costCenterId: project.costCenterId,
          description,
        });
      };
      pushDelta(assetAccount.id, result.contractAssetDelta, `POC contract asset — ${project.code}`);
      pushDelta(liabilityAccount.id, result.contractLiabilityDelta, `POC billings drawdown — ${project.code}`);
      pushDelta(revenueAccount.id, result.revenueDelta.neg(), `POC revenue — ${project.code}`);

      // journalEntryId is a required FK, so the JE must exist first; the run
      // id is pre-generated so the JE can reference it as source document.
      const runId = randomUUID();

      const journalEntry = await this.glPostingService.createPostedEntry(tx, {
        companyId,
        userId,
        postingDate: period.endDate,
        documentDate: period.endDate,
        currencyCode: company.baseCurrencyCode,
        exchangeRateToFunctional: new Prisma.Decimal(1),
        sourceModule: JournalSourceModule.PROJECTS,
        sourceDocumentId: runId,
        memo: `Revenue recognition ${project.code} — POC ${result.percentComplete.mul(100).toFixed(2)}%`,
        allowSoftClosedOverride,
        lines: glLines,
      });

      return tx.revenueRecognitionRun.create({
        data: {
          id: runId,
          companyId,
          projectId,
          fiscalPeriodId,
          runDate: new Date(),
          costsToDateFunctional: costsToDate,
          estimatedTotalCostSnapshot: project.estimatedTotalCost,
          contractValueSnapshot: project.contractValue,
          percentComplete: result.percentComplete,
          cumulativeRevenue: result.cumulativeRevenue,
          previouslyRecognized,
          recognizedThisRun: result.revenueDelta,
          journalEntryId: journalEntry.id,
          createdByUserId: userId,
        },
        include: { fiscalPeriod: true, journalEntry: { include: { lines: { include: { account: true } } } } },
      });
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "RevenueRecognitionRun",
      entityId: run.id,
      action: "POST",
      changedByUserId: userId,
      afterSnapshot: {
        projectId,
        percentComplete: run.percentComplete,
        recognizedThisRun: run.recognizedThisRun,
      },
    });

    return run;
  }

  async reverseRun(companyId: string, projectId: string, runId: string, userId: string) {
    const run = await this.prisma.revenueRecognitionRun.findFirst({
      where: { id: runId, projectId, companyId },
      include: { fiscalPeriod: true },
    });
    if (!run) {
      throw new NotFoundException("Revenue recognition run not found");
    }
    if (run.status !== RevenueRecognitionRunStatus.POSTED) {
      throw new ConflictException("Only posted runs can be reversed");
    }
    const laterRun = await this.prisma.revenueRecognitionRun.findFirst({
      where: {
        projectId,
        status: RevenueRecognitionRunStatus.POSTED,
        fiscalPeriod: { startDate: { gt: run.fiscalPeriod.endDate } },
        id: { not: runId },
      },
    });
    if (laterRun) {
      throw new ConflictException("A later posted run exists — reverse runs newest-first");
    }

    const reversed = await this.prisma.$transaction(async (tx) => {
      // Reverse INTO the run's own period: the rerun computes balances as of
      // that period's end, so a today-dated reversal would be invisible to it.
      const reversal = await this.glPostingService.reverseEntryInTx(
        tx, companyId, run.journalEntryId, userId, run.fiscalPeriod.endDate,
      );
      return tx.revenueRecognitionRun.update({
        where: { id: runId },
        data: { status: RevenueRecognitionRunStatus.REVERSED, reversalJournalEntryId: reversal.id },
      });
    }, { timeout: 30000 });

    await this.auditService.log({
      companyId,
      entityName: "RevenueRecognitionRun",
      entityId: runId,
      action: "REVERSE",
      changedByUserId: userId,
      beforeSnapshot: { status: run.status },
      afterSnapshot: { status: reversed.status },
    });

    return reversed;
  }

  async listRuns(companyId: string, projectId: string) {
    return this.prisma.revenueRecognitionRun.findMany({
      where: { companyId, projectId },
      orderBy: { createdAt: "desc" },
      include: { fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } } },
    });
  }

  /**
   * Sum of (debit − credit) as of a date for the project's cost center over
   * either all EXPENSE-class accounts or a specific control-account type.
   * Includes POSTED and REVERSED entries (reversal pairs net to zero).
   */
  private async sumByCostCenter(
    tx: TxClient,
    companyId: string,
    costCenterId: string,
    asOf: Date,
    accountFilter: "EXPENSE_CLASS" | ControlAccountType,
  ): Promise<Prisma.Decimal> {
    const rows =
      accountFilter === "EXPENSE_CLASS"
        ? await tx.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
            SELECT SUM(jel."debit" - jel."credit") AS total
            FROM "journal_entry_lines" jel
            JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
            JOIN "accounts" a ON a."id" = jel."accountId"
            JOIN "account_classes" ac ON ac."id" = a."accountClassId"
            WHERE jel."companyId" = ${companyId}
              AND jel."costCenterId" = ${costCenterId}
              AND je."status" IN ('POSTED', 'REVERSED')
              AND je."postingDate" <= ${asOf}
              AND ac."code" = 'EXPENSE'
          `
        : await tx.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
            SELECT SUM(jel."debit" - jel."credit") AS total
            FROM "journal_entry_lines" jel
            JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
            JOIN "accounts" a ON a."id" = jel."accountId"
            WHERE jel."companyId" = ${companyId}
              AND jel."costCenterId" = ${costCenterId}
              AND je."status" IN ('POSTED', 'REVERSED')
              AND je."postingDate" <= ${asOf}
              AND a."controlAccountType" = ${accountFilter}::"ControlAccountType"
          `;
    return new Prisma.Decimal(rows[0]?.total ?? 0);
  }
}
