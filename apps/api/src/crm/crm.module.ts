import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { ActivitiesService } from "./activities.service";
import { ActivitiesController } from "./activities.controller";

@Module({
  imports: [AuditModule],
  controllers: [LeadsController, OpportunitiesController, ContactsController, ActivitiesController],
  providers: [LeadsService, OpportunitiesService, ContactsService, ActivitiesService],
  exports: [LeadsService, OpportunitiesService, ContactsService, ActivitiesService],
})
export class CrmModule {}
