import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import type { EmailMessage } from "../../../infrastructure/email/email.port";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";

export interface InboundOwner {
  id: string;
  vendorId: string;
}

@Injectable()
export class InboundAlertsService {
  private readonly logger = new Logger(InboundAlertsService.name);

  constructor(
    private readonly alerts: WalletAlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async tellOwner(inbound: InboundOwner, message: (to: string, webUrl: string) => EmailMessage): Promise<void> {
    await this.alerts
      .notifyOwner(inbound.vendorId, (to) => message(to, this.config.WEB_PUBLIC_URL), `/inbound/${inbound.id}`)
      .catch((error: unknown) => this.logger.error(`Couldn't tell the vendor about shipment ${inbound.id}: ${String(error)}`));
  }
}
