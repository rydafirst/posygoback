import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../../infrastructure/email/email.port";
import { NotificationsService } from "./notifications.service";

const LINK_LINE = /^\s*https?:\/\/\S+\s*$/gm;

export type NoticeLink = string | ((person: { vendorId: string | null }) => string);

export const securityPage: NoticeLink = (person) => (person.vendorId ? "/settings/security" : "/admin/security");

@Injectable()
export class PersonalNoticesService {
  private readonly logger = new Logger(PersonalNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send(message: EmailMessage, href?: NoticeLink): Promise<void> {
    await this.post(message, href);
    await this.email.send(message);
  }

  private async post(message: EmailMessage, href?: NoticeLink): Promise<void> {
    try {
      const person = await this.prisma.user.findUnique({ where: { email: message.to.trim().toLowerCase() }, select: { id: true, status: true, vendorId: true } });
      if (person?.status === "ACTIVE") {
        await this.notifications.forUser(person.id, { title: message.subject, body: message.text.replace(LINK_LINE, ""), href: typeof href === "function" ? href(person) : (href ?? this.pagePath(message.action?.url)) });
      }
    } catch (error) {
      this.logger.warn(`Couldn't post "${message.kind ?? "notice"}" in the app: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private pagePath(url: string | undefined): string | undefined {
    const site = this.config.WEB_PUBLIC_URL.replace(/\/$/, "");
    if (!url?.startsWith(`${site}/`)) {
      return undefined;
    }
    const path = url.slice(site.length);
    return path.length <= 200 ? path : undefined;
  }
}
