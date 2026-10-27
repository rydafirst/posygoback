import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import type { NotificationFeedView } from "../../shared";
import { PLATFORM_NAME } from "../../common/brand/brand";

const FEED_SIZE = 30;
const KEEP_READ_DAYS = 90;
const SIGN_OFF = new RegExp(`\\n\\n${PLATFORM_NAME}\\s*$`);

export interface NoticeInput {
  title: string;
  body: string;
  href?: string | null;
}

function shorten(text: string, max: number): string {
  const clean = text.replace(SIGN_OFF, "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async forVendor(vendorId: string, notice: NoticeInput, client: DatabaseClient = this.prisma): Promise<void> {
    await client.notification.create({ data: { vendorId, title: shorten(notice.title, 160), body: shorten(notice.body, 400), href: notice.href ?? null } });
  }

  async forUser(userId: string, notice: NoticeInput, client: DatabaseClient = this.prisma): Promise<void> {
    await client.notification.create({ data: { userId, title: shorten(notice.title, 160), body: shorten(notice.body, 400), href: notice.href ?? null } });
  }

  async feed(principal: AuthPrincipal): Promise<NotificationFeedView> {
    const audience = this.audience(principal);
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: audience, orderBy: { createdAt: "desc" }, take: FEED_SIZE }),
      this.prisma.notification.count({ where: { ...audience, readAt: null } }),
    ]);
    return { unread, items: rows.map((row) => ({ id: row.id, title: row.title, body: row.body, href: row.href, read: row.readAt !== null, createdAt: row.createdAt.toISOString() })) };
  }

  async markRead(principal: AuthPrincipal, notificationId: string): Promise<NotificationFeedView> {
    const updated = await this.prisma.notification.updateMany({ where: { ...this.audience(principal), id: notificationId, readAt: null }, data: { readAt: new Date() } });
    if (updated.count === 0 && !(await this.prisma.notification.count({ where: { ...this.audience(principal), id: notificationId } }))) {
      throw Errors.notFound();
    }
    return this.feed(principal);
  }

  async markAllRead(principal: AuthPrincipal): Promise<NotificationFeedView> {
    await this.prisma.notification.updateMany({ where: { ...this.audience(principal), readAt: null }, data: { readAt: new Date() } });
    return this.feed(principal);
  }

  async prune(now = new Date()): Promise<number> {
    const removed = await this.prisma.notification.deleteMany({ where: { readAt: { lt: new Date(now.getTime() - KEEP_READ_DAYS * 24 * 60 * 60 * 1000) } } });
    return removed.count;
  }

  private audience(principal: AuthPrincipal): Prisma.NotificationWhereInput {
    return principal.vendorId ? { vendorId: principal.vendorId } : { userId: principal.userId };
  }
}
