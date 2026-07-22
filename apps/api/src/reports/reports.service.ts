import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

interface TrialBalanceRawRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  opening: Prisma.Decimal;
  periodDebit: Prisma.Decimal;
  periodCredit: Prisma.Decimal;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingBalance: string;
  debit: string;
  credit: string;
  closingBalance: string;
}

export interface TrialBalanceReport {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
}

/**
 * Aggregates posted (and reversed — their lines remain permanent ledger
 * history, netted out by their paired reversal entry) journal entry lines
 * by account. This is the direct ancestor of the Balance Sheet/P&L reports:
 * same aggregation, grouped by account class/sub-class instead of by account.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async trialBalance(companyId: string, asOfDate: Date): Promise<TrialBalanceReport> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { companyId, startDate: { lte: asOfDate }, endDate: { gte: asOfDate } },
    });
    const fiscalYearStart = fiscalYear?.startDate ?? new Date(0);

    const rows = await this.prisma.$queryRaw<TrialBalanceRawRow[]>`
      SELECT
        a."id" AS "accountId",
        a."code" AS "accountCode",
        a."name" AS "accountName",
        COALESCE(SUM(CASE WHEN je."postingDate" < ${fiscalYearStart} THEN jel."debit" - jel."credit" ELSE 0 END), 0) AS "opening",
        COALESCE(SUM(CASE WHEN je."postingDate" >= ${fiscalYearStart} THEN jel."debit" ELSE 0 END), 0) AS "periodDebit",
        COALESCE(SUM(CASE WHEN je."postingDate" >= ${fiscalYearStart} THEN jel."credit" ELSE 0 END), 0) AS "periodCredit"
      FROM "accounts" a
      LEFT JOIN "journal_entry_lines" jel ON jel."accountId" = a."id"
      LEFT JOIN "journal_entries" je
        ON je."id" = jel."journalEntryId"
        AND je."status" IN ('POSTED', 'REVERSED')
        AND je."postingDate" <= ${asOfDate}
      WHERE a."companyId" = ${companyId} AND a."isPostable" = true
      GROUP BY a."id", a."code", a."name"
      ORDER BY a."code" ASC
    `;

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    const mapped: TrialBalanceRow[] = rows.map((row) => {
      const opening = new Prisma.Decimal(row.opening);
      const debit = new Prisma.Decimal(row.periodDebit);
      const credit = new Prisma.Decimal(row.periodCredit);
      const closing = opening.add(debit).sub(credit);
      totalDebit = totalDebit.add(debit);
      totalCredit = totalCredit.add(credit);
      return {
        accountId: row.accountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        openingBalance: opening.toFixed(4),
        debit: debit.toFixed(4),
        credit: credit.toFixed(4),
        closingBalance: closing.toFixed(4),
      };
    });

    return {
      asOfDate: asOfDate.toISOString(),
      rows: mapped,
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
    };
  }

  /**
   * AR/AP aging: open invoices bucketed by how overdue they are at asOfDate.
   * MVP semantics: buckets CURRENT open balances by due date — not a
   * retroactive point-in-time reconstruction (an invoice paid yesterday
   * doesn't reappear when asOfDate is set to last week).
   */
  async aging(companyId: string, side: "AR" | "AP", asOfDate: Date): Promise<AgingReport> {
    const table = side === "AR" ? Prisma.raw('"sales_invoices"') : Prisma.raw('"purchase_invoices"');

    const rows = await this.prisma.$queryRaw<AgingRawRow[]>`
      SELECT
        bp."id" AS "businessPartnerId",
        bp."code" AS "partnerCode",
        bp."name" AS "partnerName",
        COALESCE(SUM(CASE WHEN i."dueDate" >= ${asOfDate} THEN i."openAmount" * i."exchangeRateToFunctional" ELSE 0 END), 0) AS "current",
        COALESCE(SUM(CASE WHEN ${asOfDate}::date - i."dueDate"::date BETWEEN 1 AND 30 THEN i."openAmount" * i."exchangeRateToFunctional" ELSE 0 END), 0) AS "days1to30",
        COALESCE(SUM(CASE WHEN ${asOfDate}::date - i."dueDate"::date BETWEEN 31 AND 60 THEN i."openAmount" * i."exchangeRateToFunctional" ELSE 0 END), 0) AS "days31to60",
        COALESCE(SUM(CASE WHEN ${asOfDate}::date - i."dueDate"::date BETWEEN 61 AND 90 THEN i."openAmount" * i."exchangeRateToFunctional" ELSE 0 END), 0) AS "days61to90",
        COALESCE(SUM(CASE WHEN ${asOfDate}::date - i."dueDate"::date > 90 THEN i."openAmount" * i."exchangeRateToFunctional" ELSE 0 END), 0) AS "days90plus",
        COALESCE(SUM(i."openAmount" * i."exchangeRateToFunctional"), 0) AS "total"
      FROM ${table} i
      JOIN "business_partners" bp ON bp."id" = i."businessPartnerId"
      WHERE i."companyId" = ${companyId}
        AND i."status" IN ('POSTED', 'PARTIALLY_PAID')
        AND i."openAmount" > 0
      GROUP BY bp."id", bp."code", bp."name"
      ORDER BY bp."code" ASC
    `;

    const zero = new Prisma.Decimal(0);
    const totals = rows.reduce(
      (acc, row) => ({
        current: acc.current.add(new Prisma.Decimal(row.current)),
        days1to30: acc.days1to30.add(new Prisma.Decimal(row.days1to30)),
        days31to60: acc.days31to60.add(new Prisma.Decimal(row.days31to60)),
        days61to90: acc.days61to90.add(new Prisma.Decimal(row.days61to90)),
        days90plus: acc.days90plus.add(new Prisma.Decimal(row.days90plus)),
        total: acc.total.add(new Prisma.Decimal(row.total)),
      }),
      { current: zero, days1to30: zero, days31to60: zero, days61to90: zero, days90plus: zero, total: zero },
    );

    return {
      asOfDate: asOfDate.toISOString(),
      rows: rows.map((row) => ({
        businessPartnerId: row.businessPartnerId,
        partnerCode: row.partnerCode,
        partnerName: row.partnerName,
        current: new Prisma.Decimal(row.current).toFixed(2),
        days1to30: new Prisma.Decimal(row.days1to30).toFixed(2),
        days31to60: new Prisma.Decimal(row.days31to60).toFixed(2),
        days61to90: new Prisma.Decimal(row.days61to90).toFixed(2),
        days90plus: new Prisma.Decimal(row.days90plus).toFixed(2),
        total: new Prisma.Decimal(row.total).toFixed(2),
      })),
      totals: {
        current: totals.current.toFixed(2),
        days1to30: totals.days1to30.toFixed(2),
        days31to60: totals.days31to60.toFixed(2),
        days61to90: totals.days61to90.toFixed(2),
        days90plus: totals.days90plus.toFixed(2),
        total: totals.total.toFixed(2),
      },
    };
  }

  /**
   * VAT return summary for a date range: output VAT by category from posted
   * sales documents (credit notes negated), input VAT from posted purchase
   * invoices, net payable. Functional currency. Shapes match the ZATCA VAT
   * return boxes (standard / zero-rated / exempt).
   */
  async vatReturn(companyId: string, fromDate: Date, toDate: Date): Promise<VatReturnReport> {
    const sales = await this.prisma.$queryRaw<VatBreakdownRawRow[]>`
      SELECT
        l."vatCategory" AS "vatCategory",
        COALESCE(SUM((CASE WHEN i."documentKind" = 'CREDIT_NOTE' THEN -1 ELSE 1 END) * l."netAmount" * i."exchangeRateToFunctional"), 0) AS "netAmount",
        COALESCE(SUM((CASE WHEN i."documentKind" = 'CREDIT_NOTE' THEN -1 ELSE 1 END) * l."vatAmount" * i."exchangeRateToFunctional"), 0) AS "vatAmount"
      FROM "sales_invoice_lines" l
      JOIN "sales_invoices" i ON i."id" = l."salesInvoiceId"
      WHERE i."companyId" = ${companyId}
        AND i."status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
        AND i."postingDate" >= ${fromDate}
        AND i."postingDate" <= ${toDate}
      GROUP BY l."vatCategory"
    `;

    const purchases = await this.prisma.$queryRaw<VatBreakdownRawRow[]>`
      SELECT
        l."vatCategory" AS "vatCategory",
        COALESCE(SUM(l."netAmount" * i."exchangeRateToFunctional"), 0) AS "netAmount",
        COALESCE(SUM(l."vatAmount" * i."exchangeRateToFunctional"), 0) AS "vatAmount"
      FROM "purchase_invoice_lines" l
      JOIN "purchase_invoices" i ON i."id" = l."purchaseInvoiceId"
      WHERE i."companyId" = ${companyId}
        AND i."status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
        AND i."postingDate" >= ${fromDate}
        AND i."postingDate" <= ${toDate}
      GROUP BY l."vatCategory"
    `;

    const zero = new Prisma.Decimal(0);
    const outputVat = sales.reduce((sum, row) => sum.add(new Prisma.Decimal(row.vatAmount)), zero);
    const inputVat = purchases.reduce((sum, row) => sum.add(new Prisma.Decimal(row.vatAmount)), zero);

    const mapBreakdown = (rows: VatBreakdownRawRow[]) =>
      rows.map((row) => ({
        vatCategory: row.vatCategory,
        netAmount: new Prisma.Decimal(row.netAmount).toFixed(2),
        vatAmount: new Prisma.Decimal(row.vatAmount).toFixed(2),
      }));

    return {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      salesByCategory: mapBreakdown(sales),
      purchasesByCategory: mapBreakdown(purchases),
      outputVat: outputVat.toFixed(2),
      inputVat: inputVat.toFixed(2),
      netVatPayable: outputVat.sub(inputVat).toFixed(2),
    };
  }

  /**
   * Current-state stock summary: exactly what must reconcile to the live
   * INVENTORY GL account balance (the totalValue column is authoritative
   * and maintained transactionally with every posting).
   */
  async stockSummary(companyId: string, warehouseId?: string): Promise<StockSummaryReport> {
    const rows = await this.prisma.$queryRaw<Array<{
      itemId: string; itemCode: string; itemName: string;
      warehouseId: string; warehouseCode: string; warehouseName: string;
      onHandQty: Prisma.Decimal; avgCost: Prisma.Decimal; totalValue: Prisma.Decimal;
    }>>`
      SELECT
        s."itemId", i."code" AS "itemCode", i."name" AS "itemName",
        s."warehouseId", w."code" AS "warehouseCode", w."name" AS "warehouseName",
        s."onHandQty", s."avgCost", s."totalValue"
      FROM "item_warehouse_stock" s
      JOIN "items" i ON i."id" = s."itemId"
      JOIN "warehouses" w ON w."id" = s."warehouseId"
      WHERE s."companyId" = ${companyId}
        AND (${warehouseId ?? null}::text IS NULL OR s."warehouseId" = ${warehouseId ?? null})
        AND (s."onHandQty" <> 0 OR s."totalValue" <> 0)
      ORDER BY i."code", w."code"
    `;

    const totalValue = rows.reduce((sum, row) => sum.add(new Prisma.Decimal(row.totalValue)), new Prisma.Decimal(0));

    return {
      rows: rows.map((row) => ({
        itemId: row.itemId,
        itemCode: row.itemCode,
        itemName: row.itemName,
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        onHandQty: new Prisma.Decimal(row.onHandQty).toFixed(6),
        avgCost: new Prisma.Decimal(row.avgCost).toFixed(6),
        totalValue: new Prisma.Decimal(row.totalValue).toFixed(4),
      })),
      totalValue: totalValue.toFixed(4),
    };
  }

  /**
   * Project profitability: one row per project with contract, billed,
   * recognized revenue, costs, POC and margin — plus per-task actuals for
   * budget-vs-actual drill (parent rollup is done client-side from the
   * flat task list).
   */
  async projectProfitability(companyId: string) {
    const projects = await this.prisma.$queryRaw<Array<{
      id: string; code: string; name: string; status: string; recognitionMethod: string;
      contractValue: Prisma.Decimal; estimatedTotalCost: Prisma.Decimal; costCenterId: string;
      billedToDate: Prisma.Decimal | null; revenueRecognized: Prisma.Decimal | null; costsToDate: Prisma.Decimal | null;
    }>>`
      SELECT
        p."id", p."code", p."name", p."status"::text, p."recognitionMethod"::text,
        p."contractValue", p."estimatedTotalCost", p."costCenterId",
        (SELECT COALESCE(SUM(CASE WHEN si."documentKind" = 'CREDIT_NOTE' THEN -sil."netAmount" ELSE sil."netAmount" END), 0)
         FROM "sales_invoice_lines" sil
         JOIN "sales_invoices" si ON si."id" = sil."salesInvoiceId"
         WHERE sil."projectId" = p."id" AND si."status" IN ('POSTED','PARTIALLY_PAID','PAID')) AS "billedToDate",
        (SELECT COALESCE(SUM(jel."credit" - jel."debit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         JOIN "account_classes" ac ON ac."id" = a."accountClassId"
         WHERE jel."costCenterId" = p."costCenterId" AND ac."code" = 'REVENUE'
           AND je."status" IN ('POSTED','REVERSED')) AS "revenueRecognized",
        (SELECT COALESCE(SUM(jel."debit" - jel."credit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         JOIN "account_classes" ac ON ac."id" = a."accountClassId"
         WHERE jel."costCenterId" = p."costCenterId" AND ac."code" = 'EXPENSE'
           AND je."status" IN ('POSTED','REVERSED')) AS "costsToDate"
      FROM "projects" p
      WHERE p."companyId" = ${companyId}
      ORDER BY p."code"
    `;

    const taskActuals = await this.prisma.$queryRaw<Array<{
      projectId: string; taskId: string; taskCode: string; taskName: string;
      parentTaskId: string | null; costBudget: Prisma.Decimal; actualCost: Prisma.Decimal | null;
    }>>`
      SELECT
        t."projectId", t."id" AS "taskId", t."code" AS "taskCode", t."name" AS "taskName",
        t."parentTaskId", t."costBudget",
        (SELECT COALESCE(SUM(jel."debit" - jel."credit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         JOIN "account_classes" ac ON ac."id" = a."accountClassId"
         WHERE jel."wbsTaskId" = t."id" AND ac."code" = 'EXPENSE'
           AND je."status" IN ('POSTED','REVERSED')) AS "actualCost"
      FROM "wbs_tasks" t
      WHERE t."companyId" = ${companyId}
      ORDER BY t."sortOrder", t."code"
    `;

    const tasksByProject = new Map<string, typeof taskActuals>();
    for (const task of taskActuals) {
      const list = tasksByProject.get(task.projectId) ?? [];
      list.push(task);
      tasksByProject.set(task.projectId, list);
    }

    return projects.map((p) => {
      const contract = new Prisma.Decimal(p.contractValue);
      const estimated = new Prisma.Decimal(p.estimatedTotalCost);
      const costs = new Prisma.Decimal(p.costsToDate ?? 0);
      const recognized = new Prisma.Decimal(p.revenueRecognized ?? 0);
      const poc = estimated.gt(0) ? Prisma.Decimal.min(costs.div(estimated), new Prisma.Decimal(1)) : new Prisma.Decimal(0);
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        recognitionMethod: p.recognitionMethod,
        contractValue: contract.toFixed(2),
        billedToDate: new Prisma.Decimal(p.billedToDate ?? 0).toFixed(2),
        revenueRecognized: recognized.toFixed(2),
        costsToDate: costs.toFixed(2),
        estimatedTotalCost: estimated.toFixed(2),
        percentComplete: poc.mul(100).toFixed(2),
        margin: recognized.sub(costs).toFixed(2),
        tasks: (tasksByProject.get(p.id) ?? []).map((t) => ({
          taskId: t.taskId,
          code: t.taskCode,
          name: t.taskName,
          parentTaskId: t.parentTaskId,
          costBudget: new Prisma.Decimal(t.costBudget).toFixed(2),
          actualCost: new Prisma.Decimal(t.actualCost ?? 0).toFixed(2),
          variance: new Prisma.Decimal(t.costBudget).sub(new Prisma.Decimal(t.actualCost ?? 0)).toFixed(2),
        })),
      };
    });
  }

  /** WIP schedule: the classic over/under-billings position, OVER_TIME only. */
  async wipSchedule(companyId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; code: string; name: string; status: string;
      contractValue: Prisma.Decimal; estimatedTotalCost: Prisma.Decimal; costCenterId: string;
      costsToDate: Prisma.Decimal | null; recognized: Prisma.Decimal | null;
      contractAsset: Prisma.Decimal | null; contractLiability: Prisma.Decimal | null;
      billedToDate: Prisma.Decimal | null;
    }>>`
      SELECT
        p."id", p."code", p."name", p."status"::text,
        p."contractValue", p."estimatedTotalCost", p."costCenterId",
        (SELECT COALESCE(SUM(jel."debit" - jel."credit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         JOIN "account_classes" ac ON ac."id" = a."accountClassId"
         WHERE jel."costCenterId" = p."costCenterId" AND ac."code" = 'EXPENSE'
           AND je."status" IN ('POSTED','REVERSED')) AS "costsToDate",
        (SELECT COALESCE(SUM(jel."credit" - jel."debit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         WHERE jel."costCenterId" = p."costCenterId" AND a."controlAccountType" = 'CONTRACT_REVENUE'
           AND je."status" IN ('POSTED','REVERSED')) AS "recognized",
        (SELECT COALESCE(SUM(jel."debit" - jel."credit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         WHERE jel."costCenterId" = p."costCenterId" AND a."controlAccountType" = 'CONTRACT_ASSET'
           AND je."status" IN ('POSTED','REVERSED')) AS "contractAsset",
        (SELECT COALESCE(SUM(jel."credit" - jel."debit"), 0)
         FROM "journal_entry_lines" jel
         JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
         JOIN "accounts" a ON a."id" = jel."accountId"
         WHERE jel."costCenterId" = p."costCenterId" AND a."controlAccountType" = 'CONTRACT_LIABILITY'
           AND je."status" IN ('POSTED','REVERSED')) AS "contractLiability",
        (SELECT COALESCE(SUM(CASE WHEN si."documentKind" = 'CREDIT_NOTE' THEN -sil."netAmount" ELSE sil."netAmount" END), 0)
         FROM "sales_invoice_lines" sil
         JOIN "sales_invoices" si ON si."id" = sil."salesInvoiceId"
         WHERE sil."projectId" = p."id" AND si."status" IN ('POSTED','PARTIALLY_PAID','PAID')) AS "billedToDate"
      FROM "projects" p
      WHERE p."companyId" = ${companyId} AND p."recognitionMethod" = 'OVER_TIME'
      ORDER BY p."code"
    `;

    return rows.map((row) => {
      const estimated = new Prisma.Decimal(row.estimatedTotalCost);
      const costs = new Prisma.Decimal(row.costsToDate ?? 0);
      const poc = estimated.gt(0) ? Prisma.Decimal.min(costs.div(estimated), new Prisma.Decimal(1)) : new Prisma.Decimal(0);
      return {
        projectId: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        contractValue: new Prisma.Decimal(row.contractValue).toFixed(2),
        estimatedTotalCost: estimated.toFixed(2),
        costsToDate: costs.toFixed(2),
        percentComplete: poc.mul(100).toFixed(2),
        revenueRecognized: new Prisma.Decimal(row.recognized ?? 0).toFixed(2),
        billedToDate: new Prisma.Decimal(row.billedToDate ?? 0).toFixed(2),
        contractAsset: new Prisma.Decimal(row.contractAsset ?? 0).toFixed(2),
        contractLiability: new Prisma.Decimal(row.contractLiability ?? 0).toFixed(2),
      };
    });
  }

  /**
   * IFRS 18 Statement of Profit or Loss for a period. Reuses the same
   * account-balance aggregation as trialBalance(), rolled up by
   * AccountSubClass.ifrs18Category instead of by individual account.
   * Produces the two new mandatory subtotals (Operating Profit, Profit
   * before financing and income tax) plus the existing Profit for the
   * period bottom line, and one management performance measure (EBITDA)
   * with its mandatory reconciliation.
   */
  async profitOrLoss(companyId: string, fromDate: Date, toDate: Date): Promise<ProfitOrLossReport> {
    const rows = await this.prisma.$queryRaw<Array<{
      subClassCode: string;
      subClassName: string;
      classCode: string;
      ifrs18Category: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>>`
      SELECT
        sc."code" AS "subClassCode",
        sc."name" AS "subClassName",
        ac."code" AS "classCode",
        sc."ifrs18Category"::text AS "ifrs18Category",
        COALESCE(SUM(jel."debit"), 0) AS "debit",
        COALESCE(SUM(jel."credit"), 0) AS "credit"
      FROM "accounts" a
      JOIN "account_sub_classes" sc ON sc."id" = a."accountSubClassId"
      JOIN "account_classes" ac ON ac."id" = a."accountClassId"
      JOIN "journal_entry_lines" jel ON jel."accountId" = a."id"
      JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
      WHERE a."companyId" = ${companyId}
        AND ac."code" IN ('REVENUE', 'EXPENSE')
        AND je."status" IN ('POSTED', 'REVERSED')
        AND je."postingDate" >= ${fromDate}
        AND je."postingDate" <= ${toDate}
      GROUP BY sc."code", sc."name", ac."code", sc."ifrs18Category"
    `;

    const zero = new Prisma.Decimal(0);
    const balanceBySubClass = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      // Revenue sub-classes are credit-normal, expense sub-classes debit-normal.
      const balance =
        row.classCode === "REVENUE"
          ? new Prisma.Decimal(row.credit).sub(row.debit)
          : new Prisma.Decimal(row.debit).sub(row.credit);
      balanceBySubClass.set(row.subClassCode, balance);
    }
    const amountFor = (subClassCode: string) => balanceBySubClass.get(subClassCode) ?? zero;

    const operatingRevenue = amountFor("OPERATING_REVENUE").add(amountFor("OTHER_INCOME"));
    const costOfSales = amountFor("COST_OF_SALES");
    const operatingExpense = amountFor("OPERATING_EXPENSE");
    const operatingProfit = operatingRevenue.sub(costOfSales).sub(operatingExpense);

    const investingIncome = amountFor("INVESTING_INCOME");
    const profitBeforeFinancingAndTax = operatingProfit.add(investingIncome);

    const financeCosts = amountFor("FINANCE_COST");
    const taxExpense = amountFor("TAX_EXPENSE");
    const profitForThePeriod = profitBeforeFinancingAndTax.sub(financeCosts).sub(taxExpense);

    const depreciationRows = await this.prisma.$queryRaw<Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(jel."debit"), 0) AS "debit", COALESCE(SUM(jel."credit"), 0) AS "credit"
      FROM "accounts" a
      JOIN "journal_entry_lines" jel ON jel."accountId" = a."id"
      JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
      WHERE a."companyId" = ${companyId}
        AND a."controlAccountType" = 'DEPRECIATION_EXPENSE'
        AND je."status" IN ('POSTED', 'REVERSED')
        AND je."postingDate" >= ${fromDate}
        AND je."postingDate" <= ${toDate}
    `;
    const depreciationExpense = new Prisma.Decimal(depreciationRows[0]?.debit ?? 0).sub(
      new Prisma.Decimal(depreciationRows[0]?.credit ?? 0),
    );
    const ebitda = operatingProfit.add(depreciationExpense);

    return {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      operatingRevenue: operatingRevenue.toFixed(2),
      costOfSales: costOfSales.toFixed(2),
      operatingExpense: operatingExpense.toFixed(2),
      operatingProfit: operatingProfit.toFixed(2),
      investingIncome: investingIncome.toFixed(2),
      profitBeforeFinancingAndTax: profitBeforeFinancingAndTax.toFixed(2),
      financeCosts: financeCosts.toFixed(2),
      taxExpense: taxExpense.toFixed(2),
      profitForThePeriod: profitForThePeriod.toFixed(2),
      managementPerformanceMeasures: [
        {
          name: "EBITDA",
          value: ebitda.toFixed(2),
          reconciliation: [
            { label: "Operating Profit", amount: operatingProfit.toFixed(2) },
            { label: "Depreciation Expense", amount: depreciationExpense.toFixed(2) },
            { label: "EBITDA", amount: ebitda.toFixed(2) },
          ],
        },
      ],
    };
  }

  /**
   * Statement of Financial Position as of a date. ASSET/LIABILITY grouped by
   * AccountSubClass.isCurrent (unchanged by IFRS 18). Since this system does
   * not run year-end closing entries, current fiscal year net income is
   * computed the same way trialBalance() computes its opening/period split
   * and folded into equity as "Current Year Earnings" so Assets = Liabilities
   * + Equity holds while the year is still open.
   */
  async financialPosition(companyId: string, asOfDate: Date): Promise<FinancialPositionReport> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { companyId, startDate: { lte: asOfDate }, endDate: { gte: asOfDate } },
    });
    const fiscalYearStart = fiscalYear?.startDate ?? new Date(0);

    const rows = await this.prisma.$queryRaw<Array<{
      subClassCode: string;
      subClassName: string;
      classCode: string;
      isCurrent: boolean | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>>`
      SELECT
        sc."code" AS "subClassCode",
        sc."name" AS "subClassName",
        ac."code" AS "classCode",
        sc."isCurrent" AS "isCurrent",
        COALESCE(SUM(jel."debit"), 0) AS "debit",
        COALESCE(SUM(jel."credit"), 0) AS "credit"
      FROM "accounts" a
      JOIN "account_sub_classes" sc ON sc."id" = a."accountSubClassId"
      JOIN "account_classes" ac ON ac."id" = a."accountClassId"
      LEFT JOIN "journal_entry_lines" jel ON jel."accountId" = a."id"
      LEFT JOIN "journal_entries" je
        ON je."id" = jel."journalEntryId"
        AND je."status" IN ('POSTED', 'REVERSED')
        AND je."postingDate" <= ${asOfDate}
      WHERE a."companyId" = ${companyId}
        AND ac."code" IN ('ASSET', 'LIABILITY', 'EQUITY')
      GROUP BY sc."code", sc."name", ac."code", sc."isCurrent"
      ORDER BY sc."code" ASC
    `;

    const toLine = (row: (typeof rows)[number]) => {
      // Asset sub-classes are debit-normal, liability/equity sub-classes credit-normal.
      const balance =
        row.classCode === "ASSET"
          ? new Prisma.Decimal(row.debit).sub(row.credit)
          : new Prisma.Decimal(row.credit).sub(row.debit);
      return { subClassCode: row.subClassCode, subClassName: row.subClassName, balance: balance.toFixed(2) };
    };
    const sumOf = (lines: Array<{ balance: string }>) =>
      lines.reduce((sum, l) => sum.add(new Prisma.Decimal(l.balance)), new Prisma.Decimal(0));

    const currentAssets = rows.filter((r) => r.classCode === "ASSET" && r.isCurrent === true).map(toLine);
    const nonCurrentAssets = rows.filter((r) => r.classCode === "ASSET" && r.isCurrent !== true).map(toLine);
    const currentLiabilities = rows.filter((r) => r.classCode === "LIABILITY" && r.isCurrent === true).map(toLine);
    const nonCurrentLiabilities = rows.filter((r) => r.classCode === "LIABILITY" && r.isCurrent !== true).map(toLine);
    const equity = rows.filter((r) => r.classCode === "EQUITY").map(toLine);

    const netIncomeRows = await this.prisma.$queryRaw<Array<{ classCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
      SELECT ac."code" AS "classCode", COALESCE(SUM(jel."debit"), 0) AS "debit", COALESCE(SUM(jel."credit"), 0) AS "credit"
      FROM "accounts" a
      JOIN "account_classes" ac ON ac."id" = a."accountClassId"
      JOIN "journal_entry_lines" jel ON jel."accountId" = a."id"
      JOIN "journal_entries" je ON je."id" = jel."journalEntryId"
      WHERE a."companyId" = ${companyId}
        AND ac."code" IN ('REVENUE', 'EXPENSE')
        AND je."status" IN ('POSTED', 'REVERSED')
        AND je."postingDate" >= ${fiscalYearStart}
        AND je."postingDate" <= ${asOfDate}
      GROUP BY ac."code"
    `;
    let currentYearEarnings = new Prisma.Decimal(0);
    for (const row of netIncomeRows) {
      currentYearEarnings =
        row.classCode === "REVENUE"
          ? currentYearEarnings.add(new Prisma.Decimal(row.credit).sub(row.debit))
          : currentYearEarnings.sub(new Prisma.Decimal(row.debit).sub(row.credit));
    }
    equity.push({ subClassCode: "CURRENT_YEAR_EARNINGS", subClassName: "Current Year Earnings", balance: currentYearEarnings.toFixed(2) });

    const totalAssets = sumOf(currentAssets).add(sumOf(nonCurrentAssets));
    const totalLiabilities = sumOf(currentLiabilities).add(sumOf(nonCurrentLiabilities));
    const totalEquity = sumOf(equity);

    return {
      asOfDate: asOfDate.toISOString(),
      currentAssets,
      nonCurrentAssets,
      currentLiabilities,
      nonCurrentLiabilities,
      equity,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      isBalanced: totalAssets.sub(totalLiabilities.add(totalEquity)).abs().lt("0.01"),
    };
  }

  /** Movement ledger with stored running balances — signed qty via CASE. */
  async stockMovements(companyId: string, itemId?: string, warehouseId?: string, from?: Date, to?: Date) {
    return this.prisma.$queryRaw`
      SELECT
        m."id", m."createdAt", m."postingDate", m."movementType",
        i."code" AS "itemCode", w."code" AS "warehouseCode",
        (CASE WHEN m."movementType" IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN') THEN m."quantity" ELSE -m."quantity" END) AS "signedQty",
        m."unitCost", m."totalCost", m."qtyAfter", m."avgCostAfter",
        m."sourceDocumentType", m."sourceDocumentId", m."memo"
      FROM "stock_movements" m
      JOIN "items" i ON i."id" = m."itemId"
      JOIN "warehouses" w ON w."id" = m."warehouseId"
      WHERE m."companyId" = ${companyId}
        AND (${itemId ?? null}::text IS NULL OR m."itemId" = ${itemId ?? null})
        AND (${warehouseId ?? null}::text IS NULL OR m."warehouseId" = ${warehouseId ?? null})
        AND (${from ?? null}::timestamp IS NULL OR m."postingDate" >= ${from ?? null})
        AND (${to ?? null}::timestamp IS NULL OR m."postingDate" <= ${to ?? null})
      ORDER BY m."createdAt" DESC
      LIMIT 500
    `;
  }
}

export interface StockSummaryRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHandQty: string;
  avgCost: string;
  totalValue: string;
}

export interface StockSummaryReport {
  rows: StockSummaryRow[];
  totalValue: string;
}

interface AgingRawRow {
  businessPartnerId: string;
  partnerCode: string;
  partnerName: string;
  current: Prisma.Decimal;
  days1to30: Prisma.Decimal;
  days31to60: Prisma.Decimal;
  days61to90: Prisma.Decimal;
  days90plus: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface AgingRow {
  businessPartnerId: string;
  partnerCode: string;
  partnerName: string;
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  days90plus: string;
  total: string;
}

export interface AgingReport {
  asOfDate: string;
  rows: AgingRow[];
  totals: Omit<AgingRow, "businessPartnerId" | "partnerCode" | "partnerName">;
}

interface VatBreakdownRawRow {
  vatCategory: string;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
}

export interface VatReturnReport {
  fromDate: string;
  toDate: string;
  salesByCategory: Array<{ vatCategory: string; netAmount: string; vatAmount: string }>;
  purchasesByCategory: Array<{ vatCategory: string; netAmount: string; vatAmount: string }>;
  outputVat: string;
  inputVat: string;
  netVatPayable: string;
}

export interface ProfitOrLossReport {
  fromDate: string;
  toDate: string;
  operatingRevenue: string;
  costOfSales: string;
  operatingExpense: string;
  operatingProfit: string;
  investingIncome: string;
  profitBeforeFinancingAndTax: string;
  financeCosts: string;
  taxExpense: string;
  profitForThePeriod: string;
  managementPerformanceMeasures: Array<{
    name: string;
    value: string;
    reconciliation: Array<{ label: string; amount: string }>;
  }>;
}

export interface FinancialPositionLine {
  subClassCode: string;
  subClassName: string;
  balance: string;
}

export interface FinancialPositionReport {
  asOfDate: string;
  currentAssets: FinancialPositionLine[];
  nonCurrentAssets: FinancialPositionLine[];
  currentLiabilities: FinancialPositionLine[];
  nonCurrentLiabilities: FinancialPositionLine[];
  equity: FinancialPositionLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  isBalanced: boolean;
}
