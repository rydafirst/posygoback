import { Module } from "@nestjs/common";

import { PartnerOperationsModule } from "../partners/operations/partner-operations.module";
import { ChatController } from "./chat.controller";
import { ChatEventsService } from "./chat-events.service";
import { ChatGateway } from "./chat.gateway";
import { ChatNotifierService } from "./chat-notifier.service";
import { ChatService } from "./chat.service";

@Module({
  imports: [PartnerOperationsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatEventsService, ChatNotifierService, ChatGateway],
})
export class ChatModule {}
