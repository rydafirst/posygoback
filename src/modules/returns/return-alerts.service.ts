import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import type { EmailMessage } from "../../infrastructure/email/email.port";
import { WalletAlertsService } from "../finance/wallets/wallet-alerts.service";

@Injectable()
export class ReturnAlertsService {
  private readonly logger = new Logger(ReturnAlertsService.name);

  constructor(
    private readonly alerts: WalletAlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async tellOwner(entry: { id: string; vendorId: string }, message: (to: string, webUrl: string) => EmailMessage): Promise<void> {
    await this.alerts
      .notifyOwner(entry.vendorId, (to) => message(to, this.config.WEB_PUBLIC_URL), "/returns")
      .catch((error: unknown) => this.logger.error(`Couldn't tell the vendor about return ${entry.id}: ${String(error)}`));
  }
}
