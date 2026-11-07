import { Injectable, Logger } from "@nestjs/common";
import type { Namespace } from "socket.io";

import { CHAT_EVENTS, type ChatMessageView, type ChatReadEvent, type ChatTypingEvent } from "../../shared";
import { ChatRooms } from "./chat-viewer";

export interface ThreadAudience {
  accountId: string;
  countryCode: string;
}

@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private namespace: Namespace | null = null;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  message(audience: ThreadAudience, views: { customer: ChatMessageView; team: ChatMessageView }): void {
    this.namespace?.to(ChatRooms.account(audience.accountId)).emit(CHAT_EVENTS.message, views.customer);
    this.namespace?.to([ChatRooms.team(null), ChatRooms.team(audience.countryCode)]).emit(CHAT_EVENTS.message, views.team);
  }

  read(audience: ThreadAudience, event: ChatReadEvent): void {
    this.namespace?.to([ChatRooms.account(audience.accountId), ChatRooms.team(null), ChatRooms.team(audience.countryCode)]).emit(CHAT_EVENTS.read, event);
  }

  typing(audience: ThreadAudience, event: ChatTypingEvent): void {
    const rooms = event.side === "CUSTOMER" ? [ChatRooms.team(null), ChatRooms.team(audience.countryCode)] : [ChatRooms.account(audience.accountId)];
    this.namespace?.to(rooms).volatile.emit(CHAT_EVENTS.typing, event);
  }

  async customerOnline(accountId: string): Promise<boolean> {
    if (!this.namespace) {
      return false;
    }
    try {
      return (await this.namespace.in(ChatRooms.account(accountId)).fetchSockets()).length > 0;
    } catch (error) {
      this.logger.warn(`Couldn't check who is online: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
