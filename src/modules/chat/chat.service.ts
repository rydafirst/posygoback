import { Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { isUniqueViolation, lockRow, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AttemptLimiterService } from "../../infrastructure/rate-limit/attempt-limiter.service";
import { CHAT_PAGE_SIZE, type ChatMessageInput, type ChatMessageView, type ChatPageView, type ChatSide, type ChatThreadView } from "../../shared";
import { randomCode } from "../stock/inbound/references";
import { ChatEventsService, type ThreadAudience } from "./chat-events.service";
import { ChatNotifierService } from "./chat-notifier.service";
import { type ChatViewer, type CustomerViewer, otherSide, threadScope } from "./chat-viewer";
import { accountOf, MESSAGE_INCLUDE, messageView, THREAD_INCLUDE, type ChatMessageRow, type ChatThreadRow, threadView } from "./chat-views";

const SEND_LIMIT = { name: "chat-send", limit: 40, windowSeconds: 60 };
const INBOX_SIZE = 100;

export interface SendResult {
  message: ChatMessageView;
  duplicate: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AttemptLimiterService,
    private readonly events: ChatEventsService,
    private readonly notifier: ChatNotifierService,
  ) {}

  async ownThread(viewer: CustomerViewer): Promise<ChatThreadRow> {
    const where = viewer.account.kind === "VENDOR" ? { vendorId: viewer.account.id } : { partnerId: viewer.account.id };
    const existing = await this.prisma.chatThread.findFirst({ where, include: THREAD_INCLUDE });
    if (existing) {
      return existing;
    }
    const countryCode =
      viewer.account.kind === "VENDOR"
        ? (await this.prisma.vendor.findUniqueOrThrow({ where: { id: viewer.account.id }, select: { countryCode: true } })).countryCode
        : (await this.prisma.fulfilmentPartner.findUniqueOrThrow({ where: { id: viewer.account.id }, select: { countryCode: true } })).countryCode;
    try {
      return await this.prisma.chatThread.create({ data: { ...where, countryCode, reference: `CHAT-${randomCode(8)}` }, include: THREAD_INCLUDE });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.chatThread.findFirstOrThrow({ where, include: THREAD_INCLUDE });
    }
  }

  async inbox(viewer: ChatViewer): Promise<ChatThreadView[]> {
    const rows = await this.prisma.chatThread.findMany({
      where: { ...threadScope(viewer), lastMessageAt: { not: null } },
      orderBy: [{ waitingSince: { sort: "asc", nulls: "last" } }, { lastMessageAt: "desc" }],
      take: INBOX_SIZE,
      include: THREAD_INCLUDE,
    });
    return this.views(viewer, rows);
  }

  async page(viewer: ChatViewer, threadId: string, before?: Date): Promise<ChatPageView> {
    const thread = await this.thread(viewer, threadId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { threadId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_PAGE_SIZE + 1,
      include: MESSAGE_INCLUDE,
    });
    const name = accountOf(thread).name;
    const [view] = await this.views(viewer, [thread]);
    return { thread: view!, messages: rows.slice(0, CHAT_PAGE_SIZE).reverse().map((row) => messageView(row, viewer.side, name)), hasMore: rows.length > CHAT_PAGE_SIZE };
  }

  async send(viewer: ChatViewer, threadId: string, input: ChatMessageInput): Promise<SendResult> {
    if (viewer.side === "TEAM" && !viewer.canReply) {
      throw Errors.forbidden("You can read messages but not reply.");
    }
    await this.thread(viewer, threadId);
    await this.limiter.consume(SEND_LIMIT, viewer.principal.userId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "chatThreads", threadId);
      const existing = await tx.chatMessage.findUnique({ where: { threadId_clientId: { threadId, clientId: input.clientId } }, include: MESSAGE_INCLUDE });
      if (existing) {
        if (existing.authorId !== viewer.principal.userId) {
          throw Errors.invalidTransition("That message id is already used.");
        }
        return { row: existing, duplicate: true, becameWaiting: false };
      }
      if (input.replyToId && !(await tx.chatMessage.count({ where: { id: input.replyToId, threadId } }))) {
        throw Errors.validation({ replyToId: ["You can only reply to a message in this conversation"] });
      }
      const before = await tx.chatThread.findUniqueOrThrow({ where: { id: threadId }, select: { waitingSince: true } });
      const row = await tx.chatMessage.create({
        data: { threadId, authorId: viewer.principal.userId, side: viewer.side, clientId: input.clientId, body: input.body, replyToId: input.replyToId ?? null },
        include: MESSAGE_INCLUDE,
      });
      await tx.chatThread.update({
        where: { id: threadId },
        data: { lastMessageAt: row.createdAt, waitingSince: viewer.side === "CUSTOMER" ? (before.waitingSince ?? row.createdAt) : null },
      });
      await this.markRead(tx, threadId, viewer, row.createdAt);
      return { row, duplicate: false, becameWaiting: viewer.side === "CUSTOMER" && !before.waitingSince };
    });
    const thread = await this.prisma.chatThread.findUniqueOrThrow({ where: { id: threadId }, include: THREAD_INCLUDE });
    const views = this.audienceViews(thread, outcome.row);
    if (!outcome.duplicate) {
      this.events.message(this.audience(thread), views);
      if (viewer.side === "TEAM") {
        await this.notifier.teamWrote(thread, outcome.row.body);
      } else if (outcome.becameWaiting) {
        await this.notifier.customerWrote(thread, outcome.row.body);
      }
    }
    return { message: viewer.side === "TEAM" ? views.team : views.customer, duplicate: outcome.duplicate };
  }

  async read(viewer: ChatViewer, threadId: string): Promise<void> {
    const thread = await this.thread(viewer, threadId);
    const readAt = new Date();
    await this.markRead(this.prisma, threadId, viewer, readAt);
    this.events.read(this.audience(thread), { threadId, side: viewer.side, readAt: readAt.toISOString() });
  }

  async typing(viewer: ChatViewer, threadId: string): Promise<void> {
    const thread = await this.thread(viewer, threadId);
    this.events.typing(this.audience(thread), { threadId, side: viewer.side });
  }

  async unread(viewer: ChatViewer): Promise<number> {
    if (viewer.side === "TEAM") {
      return this.prisma.chatThread.count({ where: { ...threadScope(viewer), waitingSince: { not: null } } });
    }
    const thread = await this.prisma.chatThread.findFirst({ where: threadScope(viewer), select: { id: true } });
    return thread ? ((await this.unreadCounts(viewer, [thread.id])).get(thread.id) ?? 0) : 0;
  }

  async thread(viewer: ChatViewer, threadId: string): Promise<ChatThreadRow> {
    const thread = await this.prisma.chatThread.findFirst({ where: { id: threadId, ...threadScope(viewer) }, include: THREAD_INCLUDE });
    if (!thread) {
      throw Errors.notFound();
    }
    return thread;
  }

  async views(viewer: ChatViewer, rows: ChatThreadRow[]): Promise<ChatThreadView[]> {
    const ids = rows.map((row) => row.id);
    const [counts, seen] = await Promise.all([this.unreadCounts(viewer, ids), this.lastRead(ids, otherSide(viewer.side))]);
    return rows.map((row) => threadView(row, counts.get(row.id) ?? 0, seen.get(row.id) ?? null));
  }

  private audience(thread: ChatThreadRow): ThreadAudience {
    return { accountId: accountOf(thread).id, countryCode: thread.countryCode };
  }

  private audienceViews(thread: ChatThreadRow, row: ChatMessageRow) {
    const name = accountOf(thread).name;
    return { customer: messageView(row, "CUSTOMER", name), team: messageView(row, "TEAM", name) };
  }

  private async markRead(client: Prisma.TransactionClient | PrismaService, threadId: string, viewer: ChatViewer, readAt: Date): Promise<void> {
    const userId = viewer.principal.userId;
    await client.chatRead.upsert({
      where: { threadId_userId: { threadId, userId } },
      create: { threadId, userId, side: viewer.side, readAt },
      update: { readAt },
    });
  }

  private async unreadCounts(viewer: ChatViewer, threadIds: string[]): Promise<Map<string, number>> {
    if (threadIds.length === 0) {
      return new Map();
    }
    const from: ChatSide = otherSide(viewer.side);
    const rows = await this.prisma.$queryRaw<Array<{ thread_id: string; unread: bigint }>>`
      SELECT m.thread_id, count(*) AS unread
      FROM chat_messages m
      LEFT JOIN chat_reads r ON r.thread_id = m.thread_id AND r.user_id = ${viewer.principal.userId}::uuid
      WHERE m.thread_id = ANY(${threadIds}::uuid[]) AND m.side = ${from}::chat_side AND (r.read_at IS NULL OR m.created_at > r.read_at)
      GROUP BY m.thread_id`;
    return new Map(rows.map((row) => [row.thread_id, Number(row.unread)]));
  }

  private async lastRead(threadIds: string[], side: ChatSide): Promise<Map<string, Date>> {
    if (threadIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.chatRead.groupBy({ by: ["threadId"], where: { threadId: { in: threadIds }, side }, _max: { readAt: true } });
    return new Map(rows.flatMap((row) => (row._max.readAt ? [[row.threadId, row._max.readAt] as const] : [])));
  }
}
