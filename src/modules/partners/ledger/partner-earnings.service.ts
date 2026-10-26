import { Injectable } from "@nestjs/common";

import { addDays, startOfUtcDay } from "../../../common/dates";
import type { Prisma } from "../../../generated/prisma/client";
import {
  type BoxCounts,
  type FeeSchedule,
  FeeQuoteError,
  onboardingFee,
  type PartnerEntryType,
  type PartnerRates,
  partnerRates,
  partnerShare,
  type ShippingMode,
  splitHoldback,
  STORAGE_TIERS,
  type StorageTier,
} from "../../../shared";
import { PartnerLedgerService } from "./partner-ledger.service";

interface Earning {
  type: PartnerEntryType;
  grossMinor: number;
  description: string;
  idempotencyKey: string;
  reference: { type: string; id: string };
}

interface EarningPartner {
  id: string;
  founding: boolean;
}

export interface BilledBox {
  warehouseId: string;
  tier: StorageTier;
}

export interface ReceivedInbound {
  id: string;
  reference: string;
  warehouseId: string;
  countryCode: string;
  feeScheduleId: string | null;
  shippingMode: ShippingMode;
  declaredBoxCounts: unknown;
}

export const SHIPPED_ORDER_STATUSES = ["HANDED_OFF", "IN_TRANSIT", "DELIVERED", "EXCEPTION", "RETURNED"] as const;

@Injectable()
export class PartnerEarningsService {
  constructor(private readonly ledger: PartnerLedgerService) {}

  async inboundReceived(tx: Prisma.TransactionClient, inbound: ReceivedInbound, received: BoxCounts): Promise<void> {
    const partner = await this.partnerOf(tx, inbound.warehouseId);
    if (!partner) {
      return;
    }
    const declared = inbound.declaredBoxCounts as BoxCounts;
    const counted = Object.fromEntries(STORAGE_TIERS.map((tier) => [tier, Math.min(received[tier] ?? 0, declared[tier] ?? 0)])) as BoxCounts;
    const schedule = await this.schedule(tx, inbound.feeScheduleId, inbound.countryCode);
    const rates = partnerRates(schedule);
    const quote = this.listPrice(schedule, counted, inbound.shippingMode);
    const boxes = STORAGE_TIERS.reduce((total, tier) => total + (counted[tier] ?? 0), 0);
    await this.credit(tx, partner, rates, {
      type: "RECEIVING",
      grossMinor: partnerShare(quote.stockingMinor, rates.receivingShareBps, partner.founding, rates) + partnerShare(quote.storageMinor, rates.storageShareBps, partner.founding, rates),
      description: `Received ${inbound.reference}: ${boxes} ${boxes === 1 ? "box" : "boxes"}`,
      idempotencyKey: `inbound:${inbound.id}`,
      reference: { type: "inbound_shipment", id: inbound.id },
    });
  }

  async orderShipped(tx: Prisma.TransactionClient, order: { id: string; reference: string; warehouseId: string; feeScheduleId: string; fulfilmentFeeMinor: bigint }): Promise<void> {
    const partner = await this.partnerOf(tx, order.warehouseId);
    if (!partner || (await tx.orderDispatchPhoto.count({ where: { orderId: order.id } })) === 0) {
      return;
    }
    const rates = partnerRates(await this.schedule(tx, order.feeScheduleId, null));
    await this.credit(tx, partner, rates, {
      type: "FULFILMENT",
      grossMinor: partnerShare(Number(order.fulfilmentFeeMinor), rates.fulfilmentShareBps, partner.founding, rates),
      description: `Packed and handed off ${order.reference}`,
      idempotencyKey: `order:${order.id}`,
      reference: { type: "order", id: order.id },
    });
  }

  async storageBilled(tx: Prisma.TransactionClient, schedule: FeeSchedule, boxes: readonly BilledBox[], runKey: string): Promise<void> {
    const byWarehouse = new Map<string, number>();
    for (const box of boxes) {
      byWarehouse.set(box.warehouseId, (byWarehouse.get(box.warehouseId) ?? 0) + (schedule.monthlyStorage[box.tier] ?? 0));
    }
    const rates = partnerRates(schedule);
    for (const [warehouseId, chargedMinor] of byWarehouse) {
      const partner = await this.partnerOf(tx, warehouseId);
      if (!partner) {
        continue;
      }
      await this.credit(tx, partner, rates, {
        type: "STORAGE_SHARE",
        grossMinor: partnerShare(chargedMinor, rates.storageShareBps, partner.founding, rates),
        description: "Share of storage charges",
        idempotencyKey: `${runKey}:${warehouseId}`,
        reference: { type: "storage_run", id: runKey },
      });
    }
  }

  private listPrice(schedule: FeeSchedule, boxes: BoxCounts, mode: ShippingMode): { stockingMinor: number; storageMinor: number } {
    try {
      return onboardingFee(schedule, boxes, mode, false);
    } catch (error) {
      if (error instanceof FeeQuoteError) {
        return { stockingMinor: 0, storageMinor: 0 };
      }
      throw error;
    }
  }

  private async credit(tx: Prisma.TransactionClient, partner: EarningPartner, rates: PartnerRates, earning: Earning): Promise<void> {
    if (earning.grossMinor <= 0) {
      return;
    }
    const { availableMinor, heldMinor } = splitHoldback(earning.grossMinor, rates);
    const common = { description: earning.description, reference: earning.reference };
    if (availableMinor > 0) {
      await this.ledger.post(tx, partner.id, { ...common, type: earning.type, bucket: "AVAILABLE", amountMinor: availableMinor, idempotencyKey: earning.idempotencyKey });
    }
    if (heldMinor > 0) {
      await this.ledger.post(tx, partner.id, {
        ...common,
        type: "HOLDBACK",
        bucket: "HELD",
        amountMinor: heldMinor,
        idempotencyKey: `${earning.idempotencyKey}:held`,
        releaseOn: addDays(startOfUtcDay(new Date()), rates.holdbackDays),
      });
    }
  }

  private async partnerOf(tx: Prisma.TransactionClient, warehouseId: string): Promise<EarningPartner | null> {
    const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { partner: { select: { id: true, founding: true } } } });
    return warehouse?.partner ?? null;
  }

  private async schedule(tx: Prisma.TransactionClient, scheduleId: string | null, countryCode: string | null): Promise<FeeSchedule> {
    const row = scheduleId
      ? await tx.feeSchedule.findUnique({ where: { id: scheduleId }, select: { schedule: true } })
      : await tx.feeSchedule.findFirst({ where: { countryCode: countryCode ?? "", status: "ACTIVE" }, select: { schedule: true } });
    return (row?.schedule ?? {}) as unknown as FeeSchedule;
  }
}
