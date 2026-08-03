import { Injectable } from "@nestjs/common";
import { EquipmentStatus, PayrollRunStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { netBookValue } from "./equipment-math";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class EquipmentReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fixed-asset register: per unit — cost, accumulated, NBV, current contract. */
  async fleetRegister(companyId: string) {
    const fleet = await this.prisma.equipment.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: {
        assignments: {
          where: { isActive: true },
          include: { contract: { select: { code: true, name: true } } },
          orderBy: { startDate: "desc" },
          take: 1,
        },
      },
    });

    const rows = [];
    for (const unit of fleet) {
      const runs = await this.prisma.depreciationRunLine.aggregate({
        where: { equipmentId: unit.id, run: { status: PayrollRunStatus.POSTED } },
        _sum: { amount: true },
      });
      const accumulated = unit.openingAccumulatedDepreciation.add(runs._sum.amount ?? ZERO);
      rows.push({
        equipmentId: unit.id,
        code: unit.code,
        name: unit.name,
        category: unit.category,
        status: unit.status,
        acquisitionDate: unit.acquisitionDate,
        acquisitionCost: unit.acquisitionCost,
        salvageValue: unit.salvageValue,
        usefulLifeMonths: unit.usefulLifeMonths,
        accumulatedDepreciation: accumulated,
        netBookValue:
          unit.status === EquipmentStatus.DISPOSED ? ZERO : netBookValue(unit.acquisitionCost, accumulated),
        currentContract: unit.assignments[0]?.contract ?? null,
        disposalProceeds: unit.disposalProceeds,
        internalDayRate: unit.internalDayRate,
      });
    }
    return rows;
  }

  /** Per contract from the GL by CC: billed 4500 − depreciation 5230 − other tagged costs. */
  async contractProfitability(companyId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        status: string;
        customerName: string;
        unitCount: bigint;
        billed: Prisma.Decimal | null;
        depreciation: Prisma.Decimal | null;
        otherCosts: Prisma.Decimal | null;
      }>
    >`
      SELECT
        ec."id", ec."code", ec."name", ec."status",
        bp."name" AS "customerName",
        (SELECT COUNT(*) FROM "equipment_assignments" ea WHERE ea."contractId" = ec."id") AS "unitCount",
        (
          SELECT COALESCE(SUM(l."credit" - l."debit"), 0)
          FROM "journal_entry_lines" l
          JOIN "journal_entries" je ON je."id" = l."journalEntryId" AND je."status" IN ('POSTED', 'REVERSED')
          JOIN "accounts" a ON a."id" = l."accountId"
          WHERE l."costCenterId" = ec."costCenterId" AND a."controlAccountType" = 'EQUIPMENT_REVENUE'
        ) AS "billed",
        (
          SELECT COALESCE(SUM(l."debit" - l."credit"), 0)
          FROM "journal_entry_lines" l
          JOIN "journal_entries" je ON je."id" = l."journalEntryId" AND je."status" IN ('POSTED', 'REVERSED')
          JOIN "accounts" a ON a."id" = l."accountId"
          WHERE l."costCenterId" = ec."costCenterId" AND a."controlAccountType" = 'DEPRECIATION_EXPENSE'
        ) AS "depreciation",
        (
          SELECT COALESCE(SUM(l."debit" - l."credit"), 0)
          FROM "journal_entry_lines" l
          JOIN "journal_entries" je ON je."id" = l."journalEntryId" AND je."status" IN ('POSTED', 'REVERSED')
          JOIN "accounts" a ON a."id" = l."accountId"
          JOIN "account_classes" ac ON ac."id" = a."accountClassId"
          WHERE l."costCenterId" = ec."costCenterId"
            AND ac."code" = 'EXPENSE'
            AND (a."controlAccountType" IS NULL OR a."controlAccountType" NOT IN ('DEPRECIATION_EXPENSE'))
        ) AS "otherCosts"
      FROM "equipment_rental_contracts" ec
      JOIN "business_partners" bp ON bp."id" = ec."businessPartnerId"
      WHERE ec."companyId" = ${companyId}
      ORDER BY ec."code"
    `;

    return rows.map((row) => {
      const billed = row.billed ?? ZERO;
      const depreciation = row.depreciation ?? ZERO;
      const otherCosts = row.otherCosts ?? ZERO;
      const margin = billed.sub(depreciation).sub(otherCosts);
      return {
        contractId: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        customerName: row.customerName,
        unitCount: Number(row.unitCount),
        billed,
        depreciation,
        otherCosts,
        margin,
        marginPct: billed.gt(0) ? margin.div(billed).mul(100).toDecimalPlaces(2) : ZERO,
      };
    });
  }
}
