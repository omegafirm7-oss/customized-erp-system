import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PartnersService } from "./partners.service";
import { PartnersController } from "./partners.controller";

@Module({
  imports: [AuditModule],
  controllers: [PartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
