import { Module } from "@nestjs/common";
import { NumberingModule } from "../numbering/numbering.module";
import { GlModule } from "../gl/gl.module";
import { AuditModule } from "../audit/audit.module";
import { ZatcaModule } from "../zatca/zatca.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountResolutionService } from "./account-resolution.service";
import { LineBuilderService } from "./line-builder.service";
import { ArService } from "./ar.service";
import { ArController } from "./ar.controller";
import { ApService } from "./ap.service";
import { ApController } from "./ap.controller";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { PurchaseQuotationsService } from "./purchase-quotations.service";
import { PurchaseQuotationsController } from "./purchase-quotations.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { SalesQuotationsService } from "./sales-quotations.service";
import { SalesQuotationsController } from "./sales-quotations.controller";
import { SalesOrdersService } from "./sales-orders.service";
import { SalesOrdersController } from "./sales-orders.controller";

@Module({
  imports: [NumberingModule, GlModule, AuditModule, ZatcaModule, InventoryModule],
  controllers: [
    ArController,
    ApController,
    PaymentsController,
    PurchaseQuotationsController,
    PurchaseOrdersController,
    SalesQuotationsController,
    SalesOrdersController,
  ],
  providers: [
    AccountResolutionService,
    LineBuilderService,
    ArService,
    ApService,
    PaymentsService,
    PurchaseQuotationsService,
    PurchaseOrdersService,
    SalesQuotationsService,
    SalesOrdersService,
  ],
  exports: [
    ArService,
    ApService,
    PaymentsService,
    PurchaseQuotationsService,
    PurchaseOrdersService,
    SalesQuotationsService,
    SalesOrdersService,
  ],
})
export class FinanceModule {}
