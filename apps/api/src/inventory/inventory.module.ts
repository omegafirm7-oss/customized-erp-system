import { Module } from "@nestjs/common";
import { NumberingModule } from "../numbering/numbering.module";
import { GlModule } from "../gl/gl.module";
import { AuditModule } from "../audit/audit.module";
// Provided directly (stateless) rather than importing FinanceModule, which
// itself imports InventoryModule — avoids a circular module dependency.
import { AccountResolutionService } from "../finance/account-resolution.service";
import { InventoryService } from "./inventory.service";
import { StockTransferService } from "./stock-transfer.service";
import { StockAdjustmentService } from "./stock-adjustment.service";
import { InventoryController } from "./inventory.controller";

@Module({
  imports: [NumberingModule, GlModule, AuditModule],
  controllers: [InventoryController],
  providers: [AccountResolutionService, InventoryService, StockTransferService, StockAdjustmentService],
  exports: [InventoryService],
})
export class InventoryModule {}
