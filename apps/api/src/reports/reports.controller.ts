import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { ReportsService } from "./reports.service";

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
