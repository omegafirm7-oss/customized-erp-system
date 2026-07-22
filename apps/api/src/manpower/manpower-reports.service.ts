import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

/**
 * Contract profitability straight from the GL by cost-center dimension:
 * billed = MANPOWER_REVENUE (4400) credits net of debits (credit notes and
 * reversals sign themselves), labor = the four payroll expense control types
 * debit-net. Reversed entries are included — their reversal JEs net them out.
 */
@Injectable()
export class ManpowerReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async contractProfitability(companyId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        status: string;
        customerName: string;
        assignmentCount: bigint;
        billed: Prisma.Decimal | null;
        laborCost: Prisma.Decimal | null;
      }>
    >`
      SELECT
        mc."id", mc."code", mc."name", mc."status",
        bp."name" AS "customerName",
        (SELECT COUNT(*) FROM "manpower_assignments" ma WHERE ma."contractId" = mc."id") AS "assignmentCount",
        (
          SELECT COALESCE(SUM(l."credit" - l."debit"), 0)
          FROM "journal_entry_lines" l
          JOIN "journal_entries" je ON je."id" = l."journalEntryId" AND je."status" IN ('POSTED', 'REVERSED')
          JOIN "accounts" a ON a."id" = l."accountId"
          WHERE l."costCenterId" = mc."costCenterId" AND a."controlAccountType" = 'MANPOWER_REVENUE'
        ) AS "billed",
        (
          SELECT COALESCE(SUM(l."debit" - l."credit"), 0)
          FROM "journal_entry_lines" l
          JOIN "journal_entries" je ON je."id" = l."journalEntryId" AND je."status" IN ('POSTED', 'REVERSED')
          JOIN "accounts" a ON a."id" = l."accountId"
          WHERE l."costCenterId" = mc."costCenterId"
            AND a."controlAccountType" IN ('SALARY_EXPENSE', 'GOSI_EXPENSE', 'EOSB_EXPENSE', 'LEAVE_EXPENSE')
        ) AS "laborCost"
      FROM "manpower_contracts" mc
      JOIN "business_partners" bp ON bp."id" = mc."businessPartnerId"
      WHERE mc."companyId" = ${companyId}
      ORDER BY mc."code"
    `;

    return rows.map((row) => {
      const billed = row.billed ?? new Prisma.Decimal(0);
      const laborCost = row.laborCost ?? new Prisma.Decimal(0);
      const margin = billed.sub(laborCost);
      return {
        contractId: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        customerName: row.customerName,
        assignmentCount: Number(row.assignmentCount),
        billed,
        laborCost,
        margin,
        marginPct: billed.gt(0) ? margin.div(billed).mul(100).toDecimalPlaces(2) : new Prisma.Decimal(0),
      };
    });
  }
}
