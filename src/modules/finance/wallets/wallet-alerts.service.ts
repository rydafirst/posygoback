import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../../../infrastructure/email/email.port";
import { Money } from "../../../shared";
import { UsersRepository } from "../../auth/users.repository";
import { NotificationsService } from "../../notifications/notifications.service";
import { FinanceEmails } from "../finance-emails";
import type { PostingResult } from "./wallet-ledger.service";

@Injectable()
export class WalletAlertsService {
  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly users: UsersRepository,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async afterPosting(result: PostingResult): Promise<void> {
    const threshold = Number(result.wallet.lowBalanceThresholdMinor);
    const after = Number(result.wallet.balanceMinor);
    if (result.duplicate || threshold === 0 || !(result.balanceBeforeMinor > threshold && after <= threshold)) {
      return;
    }
    await this.notifyOwner(result.wallet.vendorId, (to, webUrl) => FinanceEmails.lowBalance(to, Money.of(after, result.wallet.currency).format("en-GB"), webUrl), "/wallet");
  }

  async notifyOwner(vendorId: string, message: (to: string, webUrl: string) => EmailMessage, href?: string): Promise<void> {
    const owner = await this.users.findVendorOwner(vendorId);
    const built = message(owner?.email ?? "", this.config.WEB_PUBLIC_URL);
    await this.notifications.forVendor(vendorId, { title: built.subject, body: built.text, href }).catch(() => undefined);
    if (owner) {
      await this.email.send(built);
    }
  }
}
