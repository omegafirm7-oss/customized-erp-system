import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ControlAccountType,
  EquipmentStatus,
  JournalSourceModule,
  PayrollRunStatus,
  Prisma,
  TimesheetStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { GlPostingService, PostedEntryLineInput } from "../gl/gl-posting.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { netBookValue } from "./equipment-math";
import { CreateEquipmentDto, DisposeEquipmentDto, UpdateEquipmentDto } from "./dto/equipment.dtos";

type TxClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly glPostingService: GlPostingService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  async list(companyId: string, status?: EquipmentStatus) {
    return this.prisma.equipment.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { code: "asc" },
      include: {
        assignments: {
          where: { isActive: true },
          include: { contract: { select: { code: true, name: true } } },
        },
      },
    });
  }

  async get(companyId: string, equipmentId: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id: equipmentId, companyId },
      include: {
        assignments: { include: { contract: { select: { code: true, name: true } } } },
        depreciationRunLines: {
          where: { run: { status: PayrollRunStatus.POSTED } },
          include: { run: { select: { runNumber: true, fiscalPeriod: { select: { periodNumber: true } } } } },
          orderBy: { run: { createdAt: "asc" } },
        },
      },
    });
    if (!equipment) {
      throw new NotFoundException("Equipment not found");
    }
    return equipment;
  }

  /** Accumulated depreciation (opening + POSTED run lines) for one unit. */
  async accumulatedDepreciation(client: TxClient | PrismaService, equipmentId: string): Promise<Prisma.Decimal> {
    const equipment = await client.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    const runs = await client.depreciationRunLine.aggregate({
      where: { equipmentId, run: { status: PayrollRunStatus.POSTED } },
      _sum: { amount: true },
    });
    return equipment.openingAccumulatedDepreciation.add(runs._sum.amount ?? ZERO);
  }

  async create(companyId: string, userId: string, dto: CreateEquipmentDto) {
    const equipment = await this.prisma.$transaction(
      async (tx) => {
        const clash = await tx.equipment.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
        if (clash) {
          throw new ConflictException(`Equipment code ${dto.code} already exists`);
        }

        const cost = new Prisma.Decimal(dto.acquisitionCost);
        const equipmentId = randomUUID();
        let capitalizationJournalEntryId: string | null = null;

        if (dto.capitalizationCreditAccountId) {
          if (cost.lte(0)) {
            throw new BadRequestException("Capitalization requires a positive acquisition cost");
          }
          const assetAccount = await this.accountResolution.getControlAccount(
            tx,
            companyId,
            ControlAccountType.EQUIPMENT_ASSET,
          );
          const creditAccount = await this.accountResolution.getBankOrCashAccount(
            tx,
            companyId,
            dto.capitalizationCreditAccountId,
          );
          const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
          const acquisitionDate = new Date(dto.acquisitionDate);
          const entry = await this.glPostingService.createPostedEntry(tx, {
            companyId,
            userId,
            postingDate: acquisitionDate,
            documentDate: acquisitionDate,
            currencyCode: company.baseCurrencyCode,
            exchangeRateToFunctional: new Prisma.Decimal(1),
            sourceModule: JournalSourceModule.EQUIPMENT,
            sourceDocumentId: equipmentId,
            memo: `Capitalization — ${dto.code} ${dto.name}`,
            lines: [
              {
                accountId: assetAccount.id,
                debit: cost,
                credit: ZERO,
                amountInTransactionCurrency: cost,
                description: `Capitalize ${dto.code}`,
              },
              {
                accountId: creditAccount.id,
                debit: ZERO,
                credit: cost,
                amountInTransactionCurrency: cost,
                description: `Acquisition of ${dto.code}`,
              },
            ],
          });
          capitalizationJournalEntryId = entry.id;
        }

        return tx.equipment.create({
          data: {
            id: equipmentId,
            companyId,
            code: dto.code,
            name: dto.name,
            category: dto.category,
            serialNumber: dto.serialNumber,
            acquisitionDate: new Date(dto.acquisitionDate),
            acquisitionCost: cost,
            salvageValue: new Prisma.Decimal(dto.salvageValue ?? "0"),
            usefulLifeMonths: dto.usefulLifeMonths,
            depreciationStartDate: new Date(dto.depreciationStartDate ?? dto.acquisitionDate),
            openingAccumulatedDepreciation: new Prisma.Decimal(dto.openingAccumulatedDepreciation ?? "0"),
            capitalizationJournalEntryId,
            createdByUserId: userId,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "Equipment",
      entityId: equipment.id,
      action: "CREATE",
      changedByUserId: userId,
      afterSnapshot: equipment,
    });

    return equipment;
  }

  async update(companyId: string, equipmentId: string, userId: string, dto: UpdateEquipmentDto) {
    const before = await this.get(companyId, equipmentId);
    if (before.status === EquipmentStatus.DISPOSED) {
      throw new ConflictException("Disposed equipment cannot be edited");
    }
    const updated = await this.prisma.equipment.update({
      where: { id: equipmentId },
      data: { name: dto.name, category: dto.category, serialNumber: dto.serialNumber, updatedByUserId: userId },
    });
    await this.auditService.log({
      companyId,
      entityName: "Equipment",
      entityId: equipmentId,
      action: "UPDATE",
      changedByUserId: userId,
      beforeSnapshot: before,
      afterSnapshot: updated,
    });
    return updated;
  }

  /**
   * Disposal JE: Dr accumulated depreciation (clear), Dr bank proceeds,
   * Cr asset cost, balance → 4950 gain/loss. Unit → DISPOSED.
   */
  async dispose(companyId: string, equipmentId: string, userId: string, dto: DisposeEquipmentDto) {
    const disposed = await this.prisma.$transaction(
      async (tx) => {
        const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, companyId } });
        if (!equipment) {
          throw new NotFoundException("Equipment not found");
        }
        if (equipment.status === EquipmentStatus.DISPOSED) {
          throw new ConflictException("Equipment is already disposed");
        }
        const activeAssignment = await tx.equipmentAssignment.findFirst({
          where: { equipmentId, isActive: true },
        });
        if (activeAssignment) {
          throw new ConflictException("Equipment has an active rental assignment — end it first");
        }
        const openLog = await tx.usageLogEntry.findFirst({
          where: { equipmentId, usageLog: { status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.APPROVED] } } },
        });
        if (openLog) {
          throw new ConflictException("Equipment appears in an un-invoiced usage log — invoice or delete it first");
        }

        const accumulated = await this.accumulatedDepreciation(tx, equipmentId);
        const nbv = netBookValue(equipment.acquisitionCost, accumulated);
        const proceeds = new Prisma.Decimal(dto.proceeds);

        const [assetAccount, accumAccount, gainLossAccount] = await Promise.all([
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EQUIPMENT_ASSET),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.ACCUM_DEPRECIATION),
          this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.DISPOSAL_GAIN_LOSS),
        ]);
        const proceedsAccount = await this.accountResolution.getBankOrCashAccount(
          tx,
          companyId,
          dto.proceedsAccountId,
        );

        const disposalDate = dto.disposalDate ? new Date(dto.disposalDate) : new Date();
        const gainLoss = proceeds.sub(nbv); // positive = gain (credit 4950)

        const lines: PostedEntryLineInput[] = [];
        if (accumulated.gt(0)) {
          lines.push({
            accountId: accumAccount.id,
            debit: accumulated,
            credit: ZERO,
            amountInTransactionCurrency: accumulated,
            description: `Clear accumulated depreciation — ${equipment.code}`,
          });
        }
        if (proceeds.gt(0)) {
          lines.push({
            accountId: proceedsAccount.id,
            debit: proceeds,
            credit: ZERO,
            amountInTransactionCurrency: proceeds,
            description: `Disposal proceeds — ${equipment.code}`,
          });
        }
        lines.push({
          accountId: assetAccount.id,
          debit: ZERO,
          credit: equipment.acquisitionCost,
          amountInTransactionCurrency: equipment.acquisitionCost,
          description: `Derecognize ${equipment.code}`,
        });
        if (!gainLoss.isZero()) {
          const abs = gainLoss.abs();
          lines.push({
            accountId: gainLossAccount.id,
            debit: gainLoss.lt(0) ? abs : ZERO,
            credit: gainLoss.gt(0) ? abs : ZERO,
            amountInTransactionCurrency: abs,
            description: `${gainLoss.gt(0) ? "Gain" : "Loss"} on disposal — ${equipment.code}`,
          });
        }

        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const entry = await this.glPostingService.createPostedEntry(tx, {
          companyId,
          userId,
          postingDate: disposalDate,
          documentDate: disposalDate,
          currencyCode: company.baseCurrencyCode,
          exchangeRateToFunctional: new Prisma.Decimal(1),
          sourceModule: JournalSourceModule.EQUIPMENT,
          sourceDocumentId: equipmentId,
          memo: `Disposal — ${equipment.code} ${equipment.name} (NBV ${nbv}, proceeds ${proceeds})`,
          lines,
        });

        return tx.equipment.update({
          where: { id: equipmentId },
          data: {
            status: EquipmentStatus.DISPOSED,
            disposalDate,
            disposalProceeds: proceeds,
            disposalJournalEntryId: entry.id,
            updatedByUserId: userId,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "Equipment",
      entityId: equipmentId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: disposed,
    });

    return disposed;
  }

  /** Undo a disposal: reverse the JE and reactivate the unit. */
  async reverseDisposal(companyId: string, equipmentId: string, userId: string) {
    const restored = await this.prisma.$transaction(
      async (tx) => {
        const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, companyId } });
        if (!equipment) {
          throw new NotFoundException("Equipment not found");
        }
        if (equipment.status !== EquipmentStatus.DISPOSED || !equipment.disposalJournalEntryId) {
          throw new ConflictException("Equipment is not disposed");
        }
        await this.glPostingService.reverseEntryInTx(tx, companyId, equipment.disposalJournalEntryId, userId);
        return tx.equipment.update({
          where: { id: equipmentId },
          data: {
            status: EquipmentStatus.ACTIVE,
            disposalDate: null,
            disposalProceeds: null,
            disposalJournalEntryId: null,
            updatedByUserId: userId,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.auditService.log({
      companyId,
      entityName: "Equipment",
      entityId: equipmentId,
      action: "REVERSE",
      changedByUserId: userId,
      afterSnapshot: restored,
    });

    return restored;
  }
}
