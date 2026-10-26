import { Injectable } from "@nestjs/common";

import type { DatabaseClient } from "../../../database/prisma.service";
import { storefrontRates } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface HoldWindow {
  payoutReleaseAt: Date;
  returnsUntil: Date | null;
}

@Injectable()
export class HoldWindowService {
  constructor(private readonly fees: FeeSchedulesService) {}

  async from(client: DatabaseClient, order: { vendorId: string; countryCode: string }, shippedAt: Date): Promise<HoldWindow> {
    const store = await client.storefront.findUniqueOrThrow({ where: { vendorId: order.vendorId } });
    const rates = storefrontRates((await this.fees.active(order.countryCode, client)).schedule);
    const returnsMs = store.returnsAllowed ? store.returnWindowDays * DAY_MS : 0;
    return { payoutReleaseAt: new Date(shippedAt.getTime() + Math.max(returnsMs, rates.minimumHoldHours * HOUR_MS)), returnsUntil: returnsMs > 0 ? new Date(shippedAt.getTime() + returnsMs) : null };
  }
}
