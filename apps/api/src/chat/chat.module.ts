import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [AuditModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
