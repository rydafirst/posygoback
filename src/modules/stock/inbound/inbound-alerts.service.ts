import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import type { EmailMessage } from "../../../infrastructure/email/email.port";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";

export interface InboundOwner {
  id: string;
  vendorId: string;
}

export interface WaitingInbound {
  id: string;
  reference: string;
  countryCode: string;
  status: string;
  statusReason: string | null;
  warehouse: { name: string };
}

export interface SubmittedInbound {
  id: string;
  reference: string;
  countryCode: string;
  vendorName: string;
  warehouseName: string;
  arrival: string;
}

@Injectable()
export class InboundAlertsService {
  private readonly logger = new Logger(InboundAlertsService.name);

  constructor(
    private readonly alerts: WalletAlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async tellOwner(inbound: InboundOwner, message: (to: string, webUrl: string) => EmailMessage): Promise<void> {
    await this.alerts
      .notifyOwner(inbound.vendorId, (to) => message(to, this.config.WEB_PUBLIC_URL), `/inbound/${inbound.id}`)
      .catch((error: unknown) => this.logger.error(`Couldn't tell the vendor about shipment ${inbound.id}: ${String(error)}`));
  }

  async tellStaffSubmitted(inbound: SubmittedInbound): Promise<void> {
    await this.staffAlerts.raise("inboundSubmitted", {
      countryCode: inbound.countryCode,
      title: `${inbound.vendorName} sent stock shipment ${inbound.reference}`,
      body: `Expected ${inbound.arrival} at ${inbound.warehouseName}.`,
      href: `/admin/receiving/${inbound.id}`,
    });
  }

  async tellStaff(inbound: WaitingInbound, exceptUserId: string): Promise<void> {
    const held = inbound.status === "ON_HOLD";
    await this.staffAlerts.raise("inbound", {
      countryCode: inbound.countryCode,
      title: held ? `Stock shipment ${inbound.reference} is on hold at ${inbound.warehouse.name}` : `Stock shipment ${inbound.reference} arrived at ${inbound.warehouse.name}`,
      body: held ? `Held because: ${inbound.statusReason ?? "no reason given"}` : "It's at the door. Count it and book the stock in.",
      href: `/admin/receiving/${inbound.id}`,
      exceptUserId,
    });
  }
}
