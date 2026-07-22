import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  DocumentType,
  EquipmentStatus,
  FiscalPeriodStatus,
  JournalSourceModule,
  PayrollRunStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { NumberingService } from "../numbering/numbering.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { depreciationForPeriod, netBookValue } from "./equipment-math";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class DepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly numberingService: NumberingService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  async listRuns(companyId: string) {
    return this.prisma.depreciationRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        fiscalPeriod: { select: { periodNumber: true, startDate: true, endDate: true } },
        lines: { include: { equipment: { select: { code: true, name: true } }, costCenter: { select: { code: true } } } },
      },
    });
  }

  /**
   * Computes and posts one straight-line depreciation charge per active unit
   * for the period, dimensioned to the rental contract's cost center when
   * the unit's assignment covers period end. Create = post (one tx).
   */
  async runForPeriod(companyId: string, userId: string, fiscalPeriodId: string, allowSoftClosedOverride = false) {
    const runId = await this.prisma.$transaction(
      async (tx) => {
        const period = await tx.fiscalPeriod.findFirst({ where: { id: fiscalPeriodId, companyId } });
        if (!period) {
          throw new NotFoundException("Fiscal period not found");
        }
        if (period.status === FiscalPeriodStatus.CLOSED) {
          throw new ConflictException("Fiscal period is closed");
        }

        const existing = await tx.depreciationRun.findFirst({
          where: { companyId, fiscalPeriodId, status: PayrollRunStatus.POSTED },
        });
        if (existing) {
          throw new ConflictException("A posted depreciation run already exists for this period — reverse it first");
        }
        const later = await tx.depreciationRun.findFirst({
          where: {
            companyId,
            status: PayrollRunStatus.POSTED,
            fiscalPeriod: { startDate: { gt: period.startDate } },
          },
        });
        if (later) {
          throw new ConflictException("A later period already has a posted depreciation run — run periods in order");
        }

        const fleet = await tx.equipment.findMany({
          where: { companyId, status: EquipmentStatus.ACTIVE, depreciationStartDate: { lte: period.endDate } },
          orderBy: { code: "asc" },
        });

        const [expenseAccount, accumAccount] = await Promise.all([
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.DEPRECIATION_EXPENSE),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.ACCUM_DEPRECIATION),
        ]);

        const lineRows: Array<{
          equipmentId: string;
          amount: Prisma.Decimal;
          accumulatedAfter: Prisma.Decimal;
          nbvAfter: Prisma.Decimal;
          costCenterId: string | null;
        }> = [];
        const byCC = new Map<string, Prisma.Decimal>();
        let total = ZERO;

        for (const unit of fleet) {
          const priorRuns = await tx.depreciationRunLine.aggregate({
            where: { equipmentId: unit.id, run: { status: PayrollRunStatus.POSTED } },
            _sum: { amount: true },
          });
          const accumulatedSoFar = unit.openingAccumulatedDepreciation.add(priorRuns._sum.amount ?? ZERO);
          const amount = depreciationForPeriod(
            unit.acquisitionCost,
            unit.salvageValue,
            unit.usefulLifeMonths,
            accumulatedSoFar,
          );
          if (amount.lte(0)) continue;

          // Depreciation follows the unit onto the rental contract while
          // assigned (assignment covering period end; latest start wins).
          const assignment = await tx.equipmentAssignment.findFirst({
            where: {
              equipmentId: unit.id,
              isActive: true,
              startDate: { lte: period.endDate },
              OR: [{ endDate: null }, { endDate: { gte: period.endDate } }],
              contract: { status: "ACTIVE" },
            },
            orderBy: { startDate: "desc" },
            include: { contract: { select: { costCenterId: true } } },
          });
          const costCenterId = assignment?.contract.costCenterId ?? null;

          const accumulatedAfter = accumulatedSoFar.add(amount);
          lineRows.push({
            equipmentId: unit.id,
            amount,
            accumulatedAfter,
            nbvAfter: netBookValue(unit.acquisitionCost, accumulatedAfter),
            costCenterId,
          });
          const key = costCenterId ?? "";
          byCC.set(key, (byCC.get(key) ?? ZERO).add(amount));
          total = total.add(amount);
        }

        if (lineRows.length === 0) {
          throw new BadRequestException("No depreciable equipment for this period");
        }

        const runNumber = await this.numberingService.allocate(tx, {
          companyId,
          documentType: DocumentType.DEPRECIATION_RUN,
          fiscalYearId: null,
        });

        const entryLines: PostedEntryLineInput[] = [];
        for (const [ccKey, amount] of byCC) {
          entryLines.push({
            accountId: expenseAccount.id,
            debit: amount,
            credit: ZERO,
            amountInTransactionCurrency: amount,
            costCenterId: ccKey || null,
            description: `${runNumber} depreciation`,
          });
        }
        entryLines.push({
          accountId: accumAccount.id,
          debit: ZERO,
          credit: total,
          amountInTransactionCurrency: total,
          description: `${runNumber} accumulated depreciation`,
        });

        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const id = randomUUID();
        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: period.endDate,
          documentDate: new Date(),
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.EQUIPMENT,
          sourceDocumentId: id,
          memo: `Depreciation ${runNumber} — period ${period.periodNumber}`,
          allowSoftClosedOverride,
          lines: entryLines,
        });

        await tx.depreciationRun.create({
          data: {
            id,
            companyId,
            fiscalPeriodId,
            runNumber,
            journalEntryId: entry.id,
            totalAmount: total,
            createdByUserId: userId,
          },
        });
        await tx.depreciationRunLine.createMany({
          data: lineRows.map((row) => ({ runId: id, companyId, ...row })),
        });

        return id;
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "DepreciationRun",
      entityId: runId,
      action: "POST",
      changedByUserId: userId,
      afterSnapshot: { fiscalPeriodId },
    });

    const run = await this.prisma.depreciationRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        fiscalPeriod: { select: { periodNumber: true } },
        lines: { include: { equipment: { select: { code: true, name: true } } } },
      },
    });
    return run;
  }

  async reverseRun(companyId: string, runId: string, userId: string) {
    const reversed = await this.prisma.$transaction(
      async (tx) => {
        const run = await tx.depreciationRun.findFirst({
          where: { id: runId, companyId },
          include: { fiscalPeriod: true },
        });
        if (!run) {
          throw new NotFoundException("Depreciation run not found");
        }
        if (run.status !== PayrollRunStatus.POSTED) {
          throw new ConflictException("Only posted runs can be reversed");
        }
        const later = await tx.depreciationRun.findFirst({
          where: {
            companyId,
            status: PayrollRunStatus.POSTED,
            fiscalPeriod: { startDate: { gt: run.fiscalPeriod.startDate } },
          },
        });
        if (later) {
          throw new ConflictException("A later posted depreciation run exists — reverse that one first");
        }

        await this.glPostingService.reverseEntryInTx(tx, companyId, run.journalEntryId, userId, run.fiscalPeriod.endDate);
        const reversalEntry = await tx.journalEntry.findFirstOrThrow({
          where: { reversalOfEntryId: run.journalEntryId },
          select: { id: true },
        });

        return tx.depreciationRun.update({
          where: { id: runId },
          data: { status: PayrollRunStatus.REVERSED, reversalJournalEntryId: reversalEntry.id },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "DepreciationRun",
      entityId: runId,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: reversed,
    });

    return reversed;
  }
}
