import { Inject, Injectable, Logger } from "@nestjs/common";

import { EMAIL_SIGN_OFF } from "../../common/brand/brand";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { hasPermission, type Role, ROLES, roleScope } from "../../shared";
import { NotificationsService } from "./notifications.service";
import { StaffEmailSettingsService } from "./staff-email-settings.service";
import { STAFF_TOPICS, type StaffTopicKey } from "./staff-topics";

export interface StaffAlert {
  countryCode: string | null;
  title: string;
  body: string;
  href?: string;
  exceptUserId?: string;
}

@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: StaffEmailSettingsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async raise(topicKey: StaffTopicKey, alert: StaffAlert): Promise<void> {
    try {
      const recipients = await this.recipients(topicKey, alert);
      const href = alert.href ?? STAFF_TOPICS[topicKey].href;
      await this.notifications.forUsers(
        recipients.map((recipient) => recipient.id),
        { title: alert.title, body: alert.body, href },
      );
      if (recipients.length > 0 && (await this.settings.isEmailed(topicKey))) {
        await this.emailStaff(topicKey, recipients, alert, href);
      }
    } catch (error) {
      this.logger.warn(`Couldn't alert staff about ${topicKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async emailStaff(topicKey: StaffTopicKey, recipients: ReadonlyArray<{ email: string }>, alert: StaffAlert, href: string): Promise<void> {
    for (const { email } of recipients) {
      await this.email
        .send({
          to: email,
          kind: `staff.${topicKey}`,
          subject: alert.title,
          text: `${alert.body}${EMAIL_SIGN_OFF}`,
          action: { label: "Open in the admin console", url: `${this.config.WEB_PUBLIC_URL}${href}` },
        })
        .catch((error: unknown) => this.logger.warn(`Couldn't email ${email} about ${topicKey}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async recipients(topicKey: StaffTopicKey, alert: StaffAlert): Promise<Array<{ id: string; email: string }>> {
    const permitted = ROLES.filter((role) => roleScope(role) !== "VENDOR" && hasPermission(role, STAFF_TOPICS[topicKey].permission));
    const platformWide = permitted.filter((role) => roleScope(role) === "PLATFORM");
    const countryBound: Role[] = permitted.filter((role) => roleScope(role) !== "PLATFORM");
    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        vendorId: null,
        partnerId: null,
        id: alert.exceptUserId ? { not: alert.exceptUserId } : undefined,
        OR: [{ role: { in: platformWide } }, ...(alert.countryCode ? [{ role: { in: countryBound }, countryCode: alert.countryCode }] : [])],
      },
      select: { id: true, email: true },
    });
    return users;
  }
}
