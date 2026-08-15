import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { ReportsService } from "./reports.service";

// Whitelisted P&L line keys, mirroring exactly the amountFor() combinations
// ReportsService.profitOrLoss() nets into each line — so a line-detail
// breakdown's total always reconciles with the top-line report figure.
const PROFIT_OR_LOSS_LINES: Record<string, { label: string; subClassCodes: string[] }> = {
  operatingRevenue: { label: "Operating Revenue", subClassCodes: ["OPERATING_REVENUE", "OTHER_INCOME"] },
  costOfSales: { label: "Cost of Sales", subClassCodes: ["COST_OF_SALES"] },
  operatingExpense: { label: "Operating Expenses", subClassCodes: ["OPERATING_EXPENSE"] },
  investingIncome: { label: "Investing Income/(Expense)", subClassCodes: ["INVESTING_INCOME"] },
  financeCosts: { label: "Finance Costs", subClassCodes: ["FINANCE_COST"] },
  taxExpense: { label: "Tax Expense", subClassCodes: ["TAX_EXPENSE"] },
};

// Whitelisted Cash Flow line keys — bucket + sign mirror exactly how
// ReportsService.statementOfCashFlows() computes each display line (nc(bucket)
// vs nc(bucket).neg()), so a line-detail breakdown always reconciles.
const CASH_FLOW_LINES: Record<string, { bucket: string; sign: 1 | -1; label: string }> = {
  depreciation: { bucket: "DEPRECIATION", sign: -1, label: "Depreciation (non-cash addback)" },
  disposalGainLossAdjustment: { bucket: "DISPOSAL_GAIN_LOSS", sign: -1, label: "(Gain)/loss on disposal of assets" },
  financeCostsAddback: { bucket: "FINANCE_COST", sign: -1, label: "Finance costs (classified as financing)" },
  wcTradeReceivables: { bucket: "AR", sign: 1, label: "(Increase)/decrease in trade receivables" },
  wcInventory: { bucket: "INVENTORY", sign: 1, label: "(Increase)/decrease in inventory" },
  wcOtherCurrentAssets: { bucket: "OTHER_CURRENT_ASSET", sign: 1, label: "(Increase)/decrease in other current assets" },
  wcTradePayables: { bucket: "AP", sign: 1, label: "Increase/(decrease) in trade payables" },
  wcOtherCurrentLiabilities: { bucket: "OTHER_CURRENT_LIABILITY", sign: 1, label: "Increase/(decrease) in other current liabilities" },
  wcEosb: { bucket: "EOSB_PROVISION", sign: 1, label: "Increase/(decrease) in end-of-service benefits provision" },
  financingLongTermLoans: { bucket: "LONG_TERM_LOANS", sign: 1, label: "Proceeds from/(repayment of) long-term loans" },
  financingShareCapital: { bucket: "SHARE_CAPITAL", sign: 1, label: "Proceeds from issue of share capital" },
  financingDividends: { bucket: "RETAINED_EARNINGS", sign: 1, label: "Dividends/distributions paid" },
  financingFinanceCostsPaid: { bucket: "FINANCE_COST", sign: 1, label: "Finance costs paid" },
};

// JwtAuthGuard + PermissionsGuard are registered globally in AppModule.
@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("trial-balance")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async trialBalance(@CurrentCompanyId() companyId: string, @Query("asOfDate") asOfDate?: string) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.reportsService.trialBalance(companyId, date);
  }

  @Get("ar-aging")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async arAging(@CurrentCompanyId() companyId: string, @Query("asOfDate") asOfDate?: string) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.reportsService.aging(companyId, "AR", date);
  }

  @Get("ap-aging")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async apAging(@CurrentCompanyId() companyId: string, @Query("asOfDate") asOfDate?: string) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.reportsService.aging(companyId, "AP", date);
  }

  @Get("vat-return")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async vatReturn(
    @CurrentCompanyId() companyId: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    return this.reportsService.vatReturn(companyId, new Date(fromDate), new Date(toDate));
  }

  @Get("stock-summary")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async stockSummary(@CurrentCompanyId() companyId: string, @Query("warehouseId") warehouseId?: string) {
    return this.reportsService.stockSummary(companyId, warehouseId);
  }

  @Get("project-profitability")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async projectProfitability(@CurrentCompanyId() companyId: string) {
    return this.reportsService.projectProfitability(companyId);
  }

  @Get("wip-schedule")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async wipSchedule(@CurrentCompanyId() companyId: string) {
    return this.reportsService.wipSchedule(companyId);
  }

  @Get("profit-or-loss")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async profitOrLoss(
    @CurrentCompanyId() companyId: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    return this.reportsService.profitOrLoss(companyId, new Date(fromDate), new Date(toDate));
  }

  @Get("financial-position")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async financialPosition(@CurrentCompanyId() companyId: string, @Query("asOfDate") asOfDate?: string) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.reportsService.financialPosition(companyId, date);
  }

  @Get("profit-or-loss/line-detail")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async profitOrLossLineDetail(
    @CurrentCompanyId() companyId: string,
    @Query("line") line: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    const def = PROFIT_OR_LOSS_LINES[line];
    if (!def) {
      throw new BadRequestException(`Unknown profit or loss line: ${line}`);
    }
    return this.reportsService.profitOrLossLineDetail(companyId, def.subClassCodes, def.label, new Date(fromDate), new Date(toDate));
  }

  @Get("financial-position/line-detail")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async financialPositionLineDetail(
    @CurrentCompanyId() companyId: string,
    @Query("subClassCode") subClassCode: string,
    @Query("asOfDate") asOfDate?: string,
  ) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.reportsService.financialPositionLineDetail(companyId, subClassCode, date);
  }

  @Get("accounts/:accountId/transactions")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async accountTransactions(
    @CurrentCompanyId() companyId: string,
    @Param("accountId") accountId: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("asOfDate") asOfDate?: string,
  ) {
    if (asOfDate) {
      return this.reportsService.accountTransactions(companyId, accountId, { asOfDate: new Date(asOfDate) });
    }
    if (!fromDate || !toDate) {
      throw new BadRequestException("Either asOfDate, or both fromDate and toDate, are required");
    }
    return this.reportsService.accountTransactions(companyId, accountId, { fromDate: new Date(fromDate), toDate: new Date(toDate) });
  }

  @Get("changes-in-equity")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async statementOfChangesInEquity(
    @CurrentCompanyId() companyId: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    return this.reportsService.statementOfChangesInEquity(companyId, new Date(fromDate), new Date(toDate));
  }

  @Get("cash-flow")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async statementOfCashFlows(
    @CurrentCompanyId() companyId: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    return this.reportsService.statementOfCashFlows(companyId, new Date(fromDate), new Date(toDate));
  }

  @Get("cash-flow/line-detail")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async cashFlowLineDetail(
    @CurrentCompanyId() companyId: string,
    @Query("line") line: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    const def = CASH_FLOW_LINES[line];
    if (!def) {
      throw new BadRequestException(`Unknown cash flow line: ${line}`);
    }
    return this.reportsService.cashFlowLineDetail(companyId, def.bucket, def.sign, def.label, new Date(fromDate), new Date(toDate));
  }

  @Get("changes-in-equity/line-detail")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async equityLineDetail(
    @CurrentCompanyId() companyId: string,
    @Query("subClassCode") subClassCode: string,
    @Query("column") column: string,
    @Query("fromDate") fromDate: string,
    @Query("toDate") toDate: string,
  ) {
    if (column !== "opening" && column !== "otherMovements") {
      throw new BadRequestException(`Unknown equity column: ${column}`);
    }
    return this.reportsService.equityLineDetail(companyId, subClassCode, column, new Date(fromDate), new Date(toDate));
  }

  @Get("stock-movements")
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async stockMovements(
    @CurrentCompanyId() companyId: string,
    @Query("itemId") itemId?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reportsService.stockMovements(
      companyId,
      itemId,
      warehouseId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}
