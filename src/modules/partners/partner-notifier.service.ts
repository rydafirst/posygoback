import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../../infrastructure/email/email.port";

@Injectable()
export class PartnerNotifierService {
  private readonly logger = new Logger(PartnerNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(partnerId: string, build: (to: string, webUrl: string) => EmailMessage): Promise<void> {
    const partner = await this.prisma.fulfilmentPartner.findUnique({
      where: { id: partnerId },
      select: { contactEmail: true, users: { where: { role: "FULFILMENT_PARTNER", status: "ACTIVE" }, select: { email: true } } },
    });
    if (!partner) {
      return;
    }
    const recipients = new Set([partner.contactEmail, ...partner.users.map((user) => user.email)]);
    for (const to of recipients) {
      await this.email.send(build(to, this.config.WEB_PUBLIC_URL)).catch((error: unknown) => this.logger.error(`Partner email failed: ${String(error)}`));
    }
  }
}
