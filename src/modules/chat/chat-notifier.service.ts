import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { UsersRepository } from "../auth/users.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { StaffAlertsService } from "../notifications/staff-alerts.service";
import { PartnerNotifierService } from "../partners/partner-notifier.service";
import { ChatEmails } from "./chat-emails";
import { ChatEventsService } from "./chat-events.service";
import { accountOf, type ChatThreadRow } from "./chat-views";

const PREVIEW = 160;
export const CUSTOMER_MESSAGES_PAGE = { VENDOR: "/messages", PARTNER: "/admin/messages" } as const;

function preview(body: string): string {
  return body.length > PREVIEW ? `${body.slice(0, PREVIEW - 1)}…` : body;
}

@Injectable()
export class ChatNotifierService {
  private readonly logger = new Logger(ChatNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ChatEventsService,
    private readonly staffAlerts: StaffAlertsService,
    private readonly notifications: NotificationsService,
    private readonly partners: PartnerNotifierService,
    private readonly users: UsersRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async customerWrote(thread: ChatThreadRow, body: string): Promise<void> {
    const account = accountOf(thread);
    await this.staffAlerts.raise("chat", {
      countryCode: thread.countryCode,
      title: `${account.name} sent a message`,
      body: preview(body),
      href: `/admin/chat?thread=${thread.id}`,
    });
  }

  async teamWrote(thread: ChatThreadRow, body: string): Promise<void> {
    try {
      const account = accountOf(thread);
      if (await this.events.customerOnline(account.id)) {
        return;
      }
      if (!(await this.claimNotice(thread.id))) {
        return;
      }
      const href = CUSTOMER_MESSAGES_PAGE[account.kind];
      const notice = { title: "New message from the Posygo team", body: preview(body), href };
      if (account.kind === "PARTNER") {
        await this.partners.notify(account.id, (to, webUrl) => ChatEmails.newReply(to, preview(body), `${webUrl}${href}`), href);
        return;
      }
      await this.notifications.forVendor(account.id, notice);
      const owner = await this.users.findVendorOwner(account.id);
      if (owner) {
        await this.email.send(ChatEmails.newReply(owner.email, preview(body), `${this.config.WEB_PUBLIC_URL}${href}`));
      }
    } catch (error) {
      this.logger.warn(`Couldn't tell the customer about a new message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async claimNotice(threadId: string): Promise<boolean> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE chat_threads SET customer_emailed_at = now()
      WHERE id = ${threadId}::uuid
        AND (customer_emailed_at IS NULL OR customer_emailed_at < COALESCE(
          (SELECT max(read_at) FROM chat_reads WHERE thread_id = ${threadId}::uuid AND side = 'CUSTOMER'), '-infinity'))`;
    return claimed > 0;
  }
}
