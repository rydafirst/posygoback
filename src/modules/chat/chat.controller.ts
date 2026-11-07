import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { CurrentPrincipal } from "../../common/auth/decorators";
import { Errors } from "../../common/http/app-exception";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { type ChatMessageInput, chatMessageSchema, type ChatPageView, type ChatThreadView } from "../../shared";
import { ChatService, type SendResult } from "./chat.service";
import { chatViewerOf } from "./chat-viewer";

const uuid = new ParseUUIDPipe({ version: "4" });
const beforePipe = new ZodValidationPipe(z.string().datetime().optional());

@Controller({ path: "chat", version: "1" })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("thread")
  async ownThread(@CurrentPrincipal() principal: AuthPrincipal): Promise<ChatPageView> {
    const viewer = chatViewerOf(principal);
    if (viewer.side !== "CUSTOMER") {
      throw Errors.notFound();
    }
    const thread = await this.chat.ownThread(viewer);
    return this.chat.page(viewer, thread.id);
  }

  @Get("threads")
  inbox(@CurrentPrincipal() principal: AuthPrincipal): Promise<ChatThreadView[]> {
    return this.chat.inbox(chatViewerOf(principal));
  }

  @Get("unread")
  async unread(@CurrentPrincipal() principal: AuthPrincipal): Promise<{ count: number }> {
    return { count: await this.chat.unread(chatViewerOf(principal)) };
  }

  @Get("threads/:id/messages")
  messages(@Param("id", uuid) id: string, @Query("before", beforePipe) before: string | undefined, @CurrentPrincipal() principal: AuthPrincipal): Promise<ChatPageView> {
    return this.chat.page(chatViewerOf(principal), id, before ? new Date(before) : undefined);
  }

  @Post("threads/:id/messages")
  send(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(chatMessageSchema)) input: ChatMessageInput, @CurrentPrincipal() principal: AuthPrincipal): Promise<SendResult> {
    return this.chat.send(chatViewerOf(principal), id, input);
  }

  @Post("threads/:id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal): Promise<void> {
    await this.chat.read(chatViewerOf(principal), id);
  }
}
