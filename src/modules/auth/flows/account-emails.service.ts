import { Inject, Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { PersonalNoticesService, securityPage } from "../../notifications/personal-notices.service";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { AuthEmails } from "../auth-emails";
import { deviceLabel } from "../sessions/device-label";

const REMEMBERED_DAYS = 180;

function formatWhen(date: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`;
}

@Injectable()
export class AccountEmailsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notices: PersonalNoticesService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async welcome(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, vendor: { select: { businessName: true, countryCode: true } } } });
    if (user?.vendor) {
      await this.notices.send(AuthEmails.welcome(user.email, user.vendor.businessName, this.config.WEB_PUBLIC_URL), "/overview");
      await this.staffAlerts.raise("vendorJoined", {
        countryCode: user.vendor.countryCode,
        title: `${user.vendor.businessName} joined`,
        body: `A new vendor in ${user.vendor.countryCode} confirmed their email. Their business checks come next.`,
      });
    }
  }

  async locked(to: string, minutes: number): Promise<void> {
    await this.email.send(AuthEmails.accountLocked(to, minutes, this.config.WEB_PUBLIC_URL));
  }

  async afterSignIn(user: { id: string; email: string }, meta: RequestMeta, usedRecoveryCode: boolean, startedAt: Date): Promise<void> {
    if (usedRecoveryCode) {
      const remaining = await this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
      await this.notices.send(AuthEmails.recoveryCodeUsed(user.email, remaining, this.config.WEB_PUBLIC_URL), securityPage);
    }
    const earlier = await this.prisma.session.findMany({
      where: { userId: user.id, createdAt: { lt: startedAt, gte: new Date(startedAt.getTime() - REMEMBERED_DAYS * 24 * 60 * 60 * 1000) } },
      select: { userAgent: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const device = deviceLabel(meta.userAgent);
    if (earlier.length === 0 || earlier.some((session) => deviceLabel(session.userAgent) === device)) {
      return;
    }
    await this.notices.send(AuthEmails.newSignIn(user.email, { device, when: formatWhen(startedAt), ip: meta.ip }, this.config.WEB_PUBLIC_URL), securityPage);
  }
}
