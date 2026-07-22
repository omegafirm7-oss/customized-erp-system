import { Module } from "@nestjs/common";
import { CompaniesService } from "./companies.service";
import { CompaniesController } from "./companies.controller";
import { CoaModule } from "../coa/coa.module";
import { IamModule } from "../iam/iam.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [CoaModule, IamModule, AuditModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
