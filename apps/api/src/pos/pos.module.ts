import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FinanceModule } from "../finance/finance.module";
import { GlModule } from "../gl/gl.module";
import { PosApiKeyGuard } from "./pos-api-key.guard";
import { PosCounterController, PosInboundController, PosTerminalsController } from "./pos.controller";
import { PosSalesService } from "./pos-sales.service";
import { PosTerminalsService } from "./pos-terminals.service";

@Module({
  imports: [AuditModule, FinanceModule, GlModule],
  controllers: [PosInboundController, PosCounterController, PosTerminalsController],
  providers: [PosApiKeyGuard, PosSalesService, PosTerminalsService],
})
export class PosModule {}
