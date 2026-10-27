import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import type { EmailMessage } from "../../infrastructure/email/email.port";
import { PersonalNoticesService } from "../notifications/personal-notices.service";

const PARTNER_HOME = "/admin/partnership";

@Injectable()
export class PartnerNotifierService {
  private readonly logger = new Logger(PartnerNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: PersonalNoticesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(partnerId: string, build: (to: string, webUrl: string) => EmailMessage, href?: string): Promise<void> {
    const partner = await this.prisma.fulfilmentPartner.findUnique({
      where: { id: partnerId },
      select: { contactEmail: true, users: { where: { role: "FULFILMENT_PARTNER", status: "ACTIVE" }, select: { email: true } } },
    });
    if (!partner) {
      return;
    }
    const recipients = new Set([partner.contactEmail, ...partner.users.map((user) => user.email)].map((email) => email.toLowerCase()));
    for (const to of recipients) {
      const message = build(to, this.config.WEB_PUBLIC_URL);
      await this.notices.send(message, href ?? (message.action ? undefined : PARTNER_HOME)).catch((error: unknown) => this.logger.error(`Partner email failed: ${String(error)}`));
    }
  }
}
