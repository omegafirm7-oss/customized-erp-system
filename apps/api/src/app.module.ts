import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import configuration from "./core/config/configuration";
import { PrismaModule } from "./common/prisma/prisma.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { ModuleEntitlementGuard } from "./common/guards/module-entitlement.guard";
import { CompanyContextInterceptor } from "./common/interceptors/company-context.interceptor";
import { AuditModule } from "./audit/audit.module";
import { AuditInterceptor } from "./audit/audit.interceptor";
import { AuthModule } from "./auth/auth.module";
import { IamModule } from "./iam/iam.module";
import { CompaniesModule } from "./companies/companies.module";
import { CoaModule } from "./coa/coa.module";
import { NumberingModule } from "./numbering/numbering.module";
import { GlModule } from "./gl/gl.module";
import { PartnersModule } from "./partners/partners.module";
import { ItemsModule } from "./items/items.module";
import { ReportsModule } from "./reports/reports.module";
import { FinanceModule } from "./finance/finance.module";
import { ZatcaModule } from "./zatca/zatca.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ProjectsModule } from "./projects/projects.module";
import { HrModule } from "./hr/hr.module";
import { ManpowerModule } from "./manpower/manpower.module";
import { HiredEquipmentModule } from "./hired-equipment/hired-equipment.module";
import { EquipmentModule } from "./equipment/equipment.module";
import { PlatformModule } from "./platform/platform.module";
import { CrmModule } from "./crm/crm.module";
import { SettingsModule } from "./settings/settings.module";
import { ProcurementModule } from "./procurement/procurement.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuditModule,
    AuthModule,
    IamModule,
    CompaniesModule,
    CoaModule,
    NumberingModule,
    GlModule,
    PartnersModule,
    ItemsModule,
    ReportsModule,
    FinanceModule,
    ZatcaModule,
    InventoryModule,
    ProjectsModule,
    HrModule,
    ManpowerModule,
    HiredEquipmentModule,
    EquipmentModule,
    PlatformModule,
    CrmModule,
    SettingsModule,
    ProcurementModule,
  ],
  providers: [
    // Global by default — every route requires a valid JWT unless explicitly
    // marked @Public() (see auth.controller.ts). Registered here (not via
    // per-controller @UseGuards) so PermissionsGuard's IamService dependency
    // always resolves through AppModule's own injector, which imports
    // IamModule; a controller-level @UseGuards(PermissionsGuard) in a module
    // that doesn't import IamModule would fail to inject it. Order matters:
    // JwtAuthGuard runs first and populates request.user, which
    // PermissionsGuard then reads.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ModuleEntitlementGuard },
    { provide: APP_INTERCEPTOR, useClass: CompanyContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
