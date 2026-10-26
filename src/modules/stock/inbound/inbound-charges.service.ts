import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { type BoxCounts, type FeeSchedule, FeeQuoteError, type InboundEstimateInput, type InboundEstimateView, onboardingFee, type ShippingMode } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { type PostingResult, WalletLedgerService } from "../../finance/wallets/wallet-ledger.service";
import type { InboundRow } from "./inbound.repository";

@Injectable()
export class InboundChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeSchedulesService,
    private readonly ledger: WalletLedgerService,
  ) {}

  async estimate(vendorId: string, countryCode: string, input: InboundEstimateInput): Promise<InboundEstimateView> {
    const active = await this.fees.active(countryCode);
    const firstShipment = await this.isFirstShipment(this.prisma, vendorId, null);
    return { currency: active.currency, firstShipment, ...this.quote(active.schedule, input.boxCounts, input.shippingMode, firstShipment) };
  }

  async chargeOnboarding(tx: Prisma.TransactionClient, principal: AuthPrincipal, existing: InboundRow, postings: PostingResult[]): Promise<Prisma.InboundShipmentUpdateInput> {
    const active = await this.fees.active(existing.countryCode, tx);
    const walletId = await this.walletId(tx, existing);
    await lockRow(tx, "wallets", walletId);
    const quote = this.quote(active.schedule, existing.declaredBoxCounts as BoxCounts, existing.shippingMode, await this.isFirstShipment(tx, existing.vendorId, existing.id));
    if (quote.totalMinor > 0) {
      postings.push(
        await this.ledger.post(tx, walletId, {
          type: "ONBOARDING",
          amountMinor: quote.totalMinor,
          description: `Receiving and first month's storage for ${existing.reference}`,
          idempotencyKey: `onboarding:${existing.id}`,
          reference: { type: "inbound_shipment", id: existing.id },
          actorId: principal.userId,
        }),
      );
    }
    return { status: "SUBMITTED", submittedAt: new Date(), onboardingFeeMinor: BigInt(quote.totalMinor), onboardingChargedAt: new Date(), feeSchedule: { connect: { id: active.id } } };
  }

  async refundOnboarding(tx: Prisma.TransactionClient, principal: AuthPrincipal, existing: InboundRow, postings: PostingResult[]): Promise<void> {
    if (!existing.onboardingChargedAt || existing.onboardingFeeMinor === null || existing.onboardingFeeMinor <= 0n) {
      return;
    }
    postings.push(
      await this.ledger.post(tx, await this.walletId(tx, existing), {
        type: "REVERSAL",
        amountMinor: Number(existing.onboardingFeeMinor),
        description: `Refund for cancelled shipment ${existing.reference}`,
        idempotencyKey: `onboarding-refund:${existing.id}`,
        reference: { type: "inbound_shipment", id: existing.id },
        actorId: principal.userId,
      }),
    );
  }

  async payHold(tx: Prisma.TransactionClient, principal: AuthPrincipal, existing: InboundRow, postings: PostingResult[]): Promise<Prisma.InboundShipmentUpdateInput> {
    if (existing.holdChargeMinor === null || existing.holdChargeMinor <= 0n || existing.holdPaidAt || !existing.holdPlacedAt) {
      throw Errors.invalidTransition("There's nothing to pay on this hold.");
    }
    postings.push(
      await this.ledger.post(tx, await this.walletId(tx, existing), {
        type: "RECEIVING_HOLD_FEE",
        amountMinor: Number(existing.holdChargeMinor),
        description: `Hold charge for ${existing.reference}`,
        idempotencyKey: `hold:${existing.id}:${existing.holdPlacedAt.toISOString()}`,
        reference: { type: "inbound_shipment", id: existing.id },
        actorId: principal.userId,
      }),
    );
    return { status: existing.statusBeforeHold ?? "ARRIVED", statusBeforeHold: null, holdPaidAt: new Date(), statusReason: null };
  }

  private quote(schedule: FeeSchedule, boxes: BoxCounts, mode: ShippingMode, firstShipment: boolean) {
    try {
      return onboardingFee(schedule, boxes, mode, firstShipment);
    } catch (error) {
      if (error instanceof FeeQuoteError) {
        throw Errors.validation({ [error.field]: [error.message] });
      }
      throw error;
    }
  }

  private async isFirstShipment(client: PrismaService | Prisma.TransactionClient, vendorId: string, excludeId: string | null): Promise<boolean> {
    const charged = await client.inboundShipment.count({ where: { vendorId, onboardingChargedAt: { not: null }, status: { not: "CANCELLED" }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    return charged === 0;
  }

  private async walletId(tx: Prisma.TransactionClient, inbound: InboundRow): Promise<string> {
    const country = await tx.country.findUniqueOrThrow({ where: { code: inbound.countryCode }, select: { currency: true } });
    return (await this.ledger.walletFor(tx, inbound.vendorId, country.currency)).id;
  }
}
