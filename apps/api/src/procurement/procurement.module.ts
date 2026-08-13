import { Module } from "@nestjs/common";
import { NumberingModule } from "../numbering/numbering.module";
import { AuditModule } from "../audit/audit.module";
import { FinanceModule } from "../finance/finance.module";
import { RequisitionsService } from "./requisitions.service";
import { GoodsReceiptsService } from "./goods-receipts.service";
import { ProcurementController } from "./procurement.controller";

@Module({
  imports: [NumberingModule, AuditModule, FinanceModule],
  controllers: [ProcurementController],
  providers: [RequisitionsService, GoodsReceiptsService],
  exports: [RequisitionsService, GoodsReceiptsService],
})
export class ProcurementModule {}
