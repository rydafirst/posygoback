import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import type { Order } from "../../../generated/prisma/client";
import type { EmailMessage } from "../../../infrastructure/email/email.port";
import type { StaffOrderActionInput } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { OrderEmails } from "../order-emails";

type StaffStep = Extract<StaffOrderActionInput, { action: "REPACK" | "HAND_OFF" | "HOLD" | "RELEASE" }>;

export interface OrderOwner {
  id: string;
  vendorId: string;
}

@Injectable()
export class OrderAlertsService {
  private readonly logger = new Logger(OrderAlertsService.name);

  constructor(
    private readonly alerts: WalletAlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async tellOwner(order: OrderOwner, message: (to: string, webUrl: string) => EmailMessage): Promise<void> {
    await this.alerts
      .notifyOwner(order.vendorId, (to) => message(to, this.config.WEB_PUBLIC_URL), `/orders/${order.id}`)
      .catch((error: unknown) => this.logger.error(`Couldn't tell the vendor about order ${order.id}: ${String(error)}`));
  }

  shipped(order: Order): Promise<void> {
    const tracking = { carrier: order.carrier ?? "The carrier", trackingNumber: order.trackingNumber ?? "", trackingUrl: order.trackingUrl };
    return this.tellOwner(order, (to, webUrl) => OrderEmails.shipped(to, order, tracking, webUrl));
  }

  afterStaffStep(order: Order, step: StaffStep): Promise<void> {
    switch (step.action) {
      case "HAND_OFF":
        return this.shipped(order);
      case "HOLD":
        return this.tellOwner(order, (to, webUrl) => OrderEmails.onHold(to, order, step.reason, webUrl));
      case "RELEASE":
        return this.tellOwner(order, (to, webUrl) => OrderEmails.released(to, order, webUrl));
      case "REPACK":
        return Promise.resolve();
    }
  }
}
