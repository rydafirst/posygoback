import type { ChatMessage, ChatThread } from "../../generated/prisma/client";
import { type ChatAccountView, type ChatMessageView, type ChatSide, type ChatThreadView, chatReferences } from "../../shared";

export const TEAM_LABEL = "Posygo team";
const REPLY_SNIPPET = 140;

export type ChatMessageRow = ChatMessage & { author: { email: string } | null; replyTo: Pick<ChatMessage, "id" | "side" | "body"> | null };

export type ChatThreadRow = ChatThread & {
  vendor: { businessName: string } | null;
  partner: { legalName: string } | null;
  messages: Array<Pick<ChatMessage, "body" | "side" | "createdAt">>;
};

export const MESSAGE_INCLUDE = { author: { select: { email: true } }, replyTo: { select: { id: true, side: true, body: true } } } as const;

export const THREAD_INCLUDE = {
  vendor: { select: { businessName: true } },
  partner: { select: { legalName: true } },
  messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, side: true, createdAt: true } },
} as const;

export function accountOf(thread: ChatThreadRow): ChatAccountView {
  return thread.vendorId
    ? { kind: "VENDOR", id: thread.vendorId, name: thread.vendor?.businessName ?? "Seller", countryCode: thread.countryCode }
    : { kind: "PARTNER", id: thread.partnerId!, name: thread.partner?.legalName ?? "Partner", countryCode: thread.countryCode };
}

export function messageView(row: ChatMessageRow, audience: ChatSide, accountName: string): ChatMessageView {
  const authorLabel = row.side === "CUSTOMER" ? accountName : audience === "TEAM" && row.author ? row.author.email : TEAM_LABEL;
  return {
    id: row.id,
    threadId: row.threadId,
    clientId: row.clientId,
    side: row.side,
    authorId: row.authorId,
    authorLabel,
    body: row.body,
    replyTo: row.replyTo ? { id: row.replyTo.id, side: row.replyTo.side, body: row.replyTo.body.slice(0, REPLY_SNIPPET) } : null,
    references: chatReferences(row.body),
    createdAt: row.createdAt.toISOString(),
  };
}

export function threadView(row: ChatThreadRow, unread: number, otherSideReadAt: Date | null): ChatThreadView {
  const last = row.messages[0];
  return {
    id: row.id,
    reference: row.reference,
    account: accountOf(row),
    waitingSince: row.waitingSince?.toISOString() ?? null,
    lastMessage: last ? { body: last.body, side: last.side, createdAt: last.createdAt.toISOString() } : null,
    unread,
    otherSideReadAt: otherSideReadAt?.toISOString() ?? null,
  };
}
