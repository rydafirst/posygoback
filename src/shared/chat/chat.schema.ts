import { z } from "zod";

export const CHAT_SIDES = ["CUSTOMER", "TEAM"] as const;
export type ChatSide = (typeof CHAT_SIDES)[number];

export const CHAT_MESSAGE_MAX = 2000;
export const CHAT_PAGE_SIZE = 50;
export const CHAT_NAMESPACE = "/chat";

export const CHAT_EVENTS = {
  send: "send",
  read: "read",
  typing: "typing",
  message: "message",
} as const;

export const chatMessageSchema = z.object({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a message first").max(CHAT_MESSAGE_MAX, `Keep it under ${CHAT_MESSAGE_MAX} characters`),
  replyToId: z.string().uuid().optional(),
});
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatSendSchema = chatMessageSchema.extend({ threadId: z.string().uuid() });
export type ChatSendInput = z.infer<typeof chatSendSchema>;

export const chatThreadEventSchema = z.object({ threadId: z.string().uuid() });

const REFERENCE = /\b(?:CASE-[A-Z0-9]{8}|CHAT-[A-Z0-9]{8}|(?:ORD|IN|RMA|CL|TR|SF|SHP|RT|FP)-[A-Z]{2}-[A-Z0-9]{6,8})\b/g;

export function chatReferences(text: string): string[] {
  return [...new Set(text.toUpperCase().match(REFERENCE) ?? [])];
}

export interface ChatReplyView {
  id: string;
  side: ChatSide;
  body: string;
}

export interface ChatMessageView {
  id: string;
  threadId: string;
  clientId: string;
  side: ChatSide;
  authorId: string | null;
  authorLabel: string;
  body: string;
  replyTo: ChatReplyView | null;
  references: string[];
  createdAt: string;
}

export interface ChatAccountView {
  kind: "VENDOR" | "PARTNER";
  id: string;
  name: string;
  countryCode: string;
}

export interface ChatThreadView {
  id: string;
  reference: string;
  account: ChatAccountView;
  waitingSince: string | null;
  lastMessage: { body: string; side: ChatSide; createdAt: string } | null;
  unread: number;
  otherSideReadAt: string | null;
}

export interface ChatPageView {
  thread: ChatThreadView;
  messages: ChatMessageView[];
  hasMore: boolean;
}

export type ChatSendAck = { ok: true; message: ChatMessageView; duplicate: boolean } | { ok: false; error: string };

export interface ChatReadEvent {
  threadId: string;
  side: ChatSide;
  readAt: string;
}

export interface ChatTypingEvent {
  threadId: string;
  side: ChatSide;
}
