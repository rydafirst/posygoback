import { Injectable } from "@nestjs/common";

import { AppException, Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Order, OrderRateQuote, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { ERROR_CODES, type FeeSchedule, Money, orderActionAllowed, shippingWithMarkup } from "../../../shared";
import { JobLockService } from "../../finance/jobs/job-lock.service";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import type { PostingResult } from "../../finance/wallets/wallet-ledger.service";
import { CarrierAccountsService } from "../carriers/carrier-accounts.service";
import { CarrierError, type CustomsItem, type PurchasedLabel, type ShipmentParty } from "../carriers/carrier.port";
import { OrderEmails } from "../order-emails";
import { OrderAlertsService } from "./order-alerts.service";
import type { OrderActor } from "./order-creation.service";
import { LabelRecordsService } from "./label-records.service";
import { OrderChargesService } from "./order-charges.service";
import { OrderTimelineService } from "./order-timeline.service";
import { OrdersRepository } from "./orders.repository";
import { PLATFORM_NAME } from "../../../common/brand/brand";

const RATE_TTL_MS = 12 * 60 * 60 * 1000;
const LABEL_LOCK_MS = 120_000;

type Outcome = "LABEL_PURCHASED" | "AWAITING_WALLET_FUNDING";

function isWalletProblem(error: unknown): boolean {
  return error instanceof AppException && (error.code === ERROR_CODES.insufficientFunds || error.code === ERROR_CODES.walletUnavailable);
}

@Injectable()
export class OrderShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly carriers: CarrierAccountsService,
    private readonly charges: OrderChargesService,
    private readonly timeline: OrderTimelineService,
    private readonly locks: JobLockService,
    private readonly alerts: WalletAlertsService,
    private readonly audit: AuditService,
    private readonly labels: LabelRecordsService,
    private readonly owners: OrderAlertsService,
  ) {}

  async fetchRates(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput): Promise<void> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...scope }, include: { warehouse: true, lines: true } });
    if (!order) {
      throw Errors.notFound();
    }
    if (!orderActionAllowed("FETCH_RATES", order.status) || !order.packedAt || !order.packedLengthMm || !order.packedWidthMm || !order.packedHeightMm || !order.packedWeightGrams) {
      throw Errors.invalidTransition("Record the packed parcel before fetching rates.");
    }
    const { account, adapter } = this.carriers.forCountry(order.originCountryCode);
    const addressLines = order.warehouse.addressLines as string[];
    const from: ShipmentParty = {
      name: `${PLATFORM_NAME} ${order.warehouse.name}`.slice(0, 100),
      line1: addressLines[0] ?? "",
      line2: addressLines[1],
      city: order.warehouse.city,
      postalCode: order.warehouse.postalCode,
      countryCode: order.warehouse.countryCode,
      phone: account.provider === "SHIPPO" ? account.senderPhone : undefined,
      email: account.provider === "SHIPPO" ? account.senderEmail : undefined,
    };
    const customs: CustomsItem[] | null = order.customsRequired
      ? order.lines.map((line) => ({
          description: line.productName,
          quantity: line.quantity,
          unitValueMinor: line.unitValueMinor,
          netWeightGrams: line.unitWeightGrams,
          originCountry: line.countryOfOrigin,
          hsCode: line.hsCode ?? "",
        }))
      : null;
    const rates = await this.carrierCall(() =>
      adapter.quote({
        reference: order.reference,
        currency: order.currency,
        from,
        to: this.orders.recipient(order),
        parcel: { lengthMm: order.packedLengthMm!, widthMm: order.packedWidthMm!, heightMm: order.packedHeightMm!, weightGrams: order.packedWeightGrams! },
        customs,
      }),
    );
    if (rates.length === 0) {
      throw Errors.carrierFailed("No carrier offered a rate for this parcel. Check its size and the address.");
    }
    const schedule = (await this.prisma.feeSchedule.findUniqueOrThrow({ where: { id: order.feeScheduleId } })).schedule as unknown as FeeSchedule;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, order.id);
      if (!orderActionAllowed("FETCH_RATES", current.status) || current.packedAt?.getTime() !== order.packedAt!.getTime()) {
        throw Errors.invalidTransition("This order changed while rates were being fetched. Try again.");
      }
      await tx.orderRateQuote.updateMany({ where: { orderId: order.id, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.orderRateQuote.createMany({
        data: rates.map((rate) => ({
          orderId: order.id,
          providerRateId: rate.providerRateId,
          carrier: rate.carrier,
          carrierCode: rate.carrierCode,
          service: rate.service,
          currency: rate.currency,
          costMinor: BigInt(rate.costMinor),
          chargeMinor: BigInt(shippingWithMarkup(schedule, rate.costMinor)),
          estimatedDays: rate.estimatedDays,
        })),
      });
      await tx.order.update({ where: { id: order.id }, data: { status: "AWAITING_SHIPPING_SELECTION", selectedRateId: null } });
      await this.timeline.add(tx, order.id, {
        type: "rates.fetched",
        description: `${rates.length} shipping ${rates.length === 1 ? "option" : "options"} found`,
        source: "STAFF",
        actorId: actor.userId,
      });
    });
  }

  async selectRate(actor: OrderActor, orderId: string, rateId: string, scope: Prisma.OrderWhereInput): Promise<Outcome> {
    await this.inScope(orderId, scope);
    let posting: PostingResult | null = null;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await this.locked(tx, orderId);
      if (!orderActionAllowed("SELECT_RATE", order.status)) {
        throw Errors.invalidTransition("Fetch rates before choosing one.");
      }
      const quote = await tx.orderRateQuote.findFirst({ where: { id: rateId, orderId, supersededAt: null } });
      if (!quote) {
        throw Errors.validation({ rateId: ["Choose one of the current shipping options"] });
      }
      if (Date.now() - quote.createdAt.getTime() > RATE_TTL_MS) {
        throw Errors.invalidTransition("These rates have expired. Fetch them again.");
      }
      try {
        posting = order.source === "STOREFRONT" ? null : await this.charges.chargeShipping(tx, order, quote.id, Number(quote.chargeMinor), actor.userId);
      } catch (error) {
        if (!isWalletProblem(error)) {
          throw error;
        }
        await tx.order.update({ where: { id: orderId }, data: { status: "AWAITING_WALLET_FUNDING", selectedRateId: quote.id } });
        await this.timeline.add(tx, orderId, {
          type: "shipping.awaiting_funds",
          description: `Waiting for the vendor to add funds for ${quote.carrier} ${quote.service}`,
          source: "STAFF",
          actorId: actor.userId,
        });
        return "AWAITING_WALLET_FUNDING" as const;
      }
      await this.markPaid(tx, order, quote, actor);
      return "PAID" as const;
    });
    if (outcome === "AWAITING_WALLET_FUNDING") {
      await this.askForFunds(orderId);
      return outcome;
    }
    if (posting) {
      await this.alerts.afterPosting(posting);
    }
    return this.purchase(orderId, actor);
  }

  async payShipping(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput): Promise<Outcome | "RATES_EXPIRED"> {
    await this.inScope(orderId, scope);
    let posting: PostingResult | null = null;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await this.locked(tx, orderId);
      const quote = order.selectedRateId ? await tx.orderRateQuote.findFirst({ where: { id: order.selectedRateId, supersededAt: null } }) : null;
      if (!orderActionAllowed("PAY_SHIPPING", order.status) || !quote) {
        throw Errors.invalidTransition("There's no shipping waiting to be paid on this order.");
      }
      if (Date.now() - quote.createdAt.getTime() > RATE_TTL_MS) {
        await this.expireRates(tx, orderId);
        await this.timeline.add(tx, orderId, { type: "rates.expired", description: "The shipping price expired. The warehouse will fetch a fresh one.", source: "SYSTEM" });
        return "RATES_EXPIRED" as const;
      }
      posting = await this.charges.chargeShipping(tx, order, quote.id, Number(quote.chargeMinor), actor.userId);
      await this.markPaid(tx, order, quote, actor);
      return "PAID" as const;
    });
    if (outcome === "RATES_EXPIRED") {
      return outcome;
    }
    if (posting) {
      await this.alerts.afterPosting(posting);
    }
    return this.purchase(orderId, actor);
  }

  async retryLabel(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput): Promise<Outcome> {
    const order = await this.inScope(orderId, scope);
    if (!orderActionAllowed("RETRY_LABEL", order.status)) {
      throw Errors.invalidTransition("This order isn't waiting for a label.");
    }
    return this.purchase(orderId, actor, true);
  }

  private async purchase(orderId: string, actor: OrderActor, checkExisting = false): Promise<Outcome> {
    const result = await this.locks.runExclusive(`order-label:${orderId}`, LABEL_LOCK_MS, () => this.buy(orderId, actor, checkExisting));
    if (result === null) {
      throw Errors.invalidTransition("A label is already being bought for this order.");
    }
    return result;
  }

  private async buy(orderId: string, actor: OrderActor, checkExisting: boolean): Promise<Outcome> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { selectedRate: true } });
    const quote = order.selectedRate;
    if (order.status !== "SHIPPING_PAID" || !quote) {
      throw Errors.invalidTransition("This order isn't waiting for a label.");
    }
    const { adapter } = this.carriers.forCountry(order.originCountryCode);
    let label: PurchasedLabel;
    try {
      label = (checkExisting ? await adapter.findLabel(quote) : null) ?? (await adapter.buyLabel(quote, order.reference));
    } catch (error) {
      if (!(error instanceof CarrierError)) {
        throw error;
      }
      if (!error.definite) {
        await this.labels.unconfirmed(orderId, error.message);
        throw Errors.carrierFailed(`${error.message} The order stays paid; check the carrier account, then try the label again. A label already bought will be picked up rather than bought twice.`);
      }
      await this.rollBack(orderId, quote, error.message);
      throw Errors.carrierFailed(`${error.message} The shipping charge has been returned to the wallet; choose a rate again.`);
    }
    let kept: boolean;
    try {
      kept = await this.labels.record(orderId, label, actor);
    } catch (error) {
      await this.labels.voidLabel(orderId, adapter, label.transactionId, "The label couldn't be saved, so it was voided.");
      throw error;
    }
    if (!kept) {
      await this.labels.voidLabel(orderId, adapter, label.transactionId, "The order changed while the label was being bought, so the label was voided.");
      throw Errors.invalidTransition("The order changed while the label was being bought, so the label was voided.");
    }
    return "LABEL_PURCHASED";
  }

  private async rollBack(orderId: string, quote: OrderRateQuote, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.locked(tx, orderId);
      if (order.status !== "SHIPPING_PAID") {
        return;
      }
      if (order.source !== "STOREFRONT") {
        await this.charges.refundShipping(tx, order, quote.id, Number(quote.chargeMinor));
      }
      await this.expireRates(tx, orderId);
      await tx.order.update({ where: { id: orderId }, data: { shippingCostMinor: null, shippingChargeMinor: null } });
      await this.timeline.add(tx, orderId, { type: "label.failed", description: `The label couldn't be bought: ${reason} The shipping charge was returned.`, source: "SYSTEM" });
      await this.audit.record({ actor: { userId: null, role: null }, action: "order.label_failed", resourceType: "order", resourceId: orderId, vendorId: order.vendorId, after: { reason } }, tx);
    });
  }

  private async markPaid(tx: Prisma.TransactionClient, order: Order, quote: OrderRateQuote, actor: OrderActor): Promise<void> {
    const buyerPaid = order.source === "STOREFRONT";
    await tx.order.update({
      where: { id: order.id },
      data: { status: "SHIPPING_PAID", selectedRateId: quote.id, shippingCostMinor: quote.costMinor, shippingChargeMinor: buyerPaid ? 0n : quote.chargeMinor },
    });
    await this.timeline.add(tx, order.id, {
      type: "shipping.paid",
      description: buyerPaid
        ? `Delivery by ${quote.carrier} ${quote.service}, paid by the buyer at checkout`
        : `${Money.of(Number(quote.chargeMinor), quote.currency).format("en-GB")} taken for ${quote.carrier} ${quote.service}`,
      source: actor.role && ["VENDOR_OWNER", "VENDOR_MEMBER"].includes(actor.role) ? "VENDOR" : "STAFF",
      actorId: actor.userId,
    });
  }

  private async expireRates(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.orderRateQuote.updateMany({ where: { orderId, supersededAt: null }, data: { supersededAt: new Date() } });
    await tx.order.update({ where: { id: orderId }, data: { status: "AWAITING_SHIPPING_SELECTION", selectedRateId: null } });
  }

  private async askForFunds(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { selectedRate: true } });
    const amount = Money.of(Number(order.selectedRate?.chargeMinor ?? 0), order.currency).format("en-GB");
    await this.owners.tellOwner(order, (to, webUrl) => OrderEmails.awaitingFunds(to, order, amount, webUrl));
  }

  private async inScope(orderId: string, scope: Prisma.OrderWhereInput): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...scope } });
    if (!order) {
      throw Errors.notFound();
    }
    return order;
  }

  private async locked(tx: Prisma.TransactionClient, orderId: string): Promise<Order> {
    await lockRow(tx, "orders", orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  private async carrierCall<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CarrierError) {
        throw Errors.carrierFailed(error.message);
      }
      throw error;
    }
  }
}
