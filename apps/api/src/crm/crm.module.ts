import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../common/mail/mail.module";
import { SalesAgentAiService } from "./agent/sales-agent-ai.service";
import { OutreachService } from "./agent/outreach.service";
import { SalesAgentController } from "./agent/sales-agent.controller";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { ActivitiesService } from "./activities.service";
import { ActivitiesController } from "./activities.controller";

@Module({
  imports: [AuditModule, MailModule],
  controllers: [LeadsController, OpportunitiesController, ContactsController, ActivitiesController, SalesAgentController],
  providers: [LeadsService, OpportunitiesService, ContactsService, ActivitiesService, SalesAgentAiService, OutreachService],
  exports: [LeadsService, OpportunitiesService, ContactsService, ActivitiesService],
})
export class CrmModule {}
