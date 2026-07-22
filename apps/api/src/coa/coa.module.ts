import { Module } from "@nestjs/common";
import { CoaService } from "./coa.service";
import { CoaController } from "./coa.controller";

@Module({
  controllers: [CoaController],
  providers: [CoaService],
  exports: [CoaService],
})
export class CoaModule {}
