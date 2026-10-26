import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { type CheckoutInput, type CheckoutStartedView, priceOrder, type QuoteInput, type QuoteView, type StorefrontOrderView } from "../../../shared";
import { PaymentAccountsService } from "../../finance/payments/payment-accounts.service";
import { PaymentEventsService } from "../../finance/payments/payment-events.service";
import { randomCode } from "../../stock/inbound/references";
import { STOREFRONT_ORDER_INCLUDE, StorefrontRepository } from "../storefront.repository";
import { CheckoutPreparationService, type PreparedCheckout } from "./checkout-preparation.service";
import { DiscountsService } from "./discounts.service";

const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const PER_EMAIL = { name: "storefront-checkout-email", limit: 10, windowSeconds: 60 * 60 };
const PER_IP = { name: "storefront-checkout-ip", limit: 30, windowSeconds: 60 * 60 };

const RECEIPT_LINK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly preparation: CheckoutPreparationService,
    private readonly discounts: DiscountsService,
    private readonly payments: PaymentAccountsService,
    private readonly events: PaymentEventsService,
    private readonly repository: StorefrontRepository,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async quote(slug: string, input: QuoteInput): Promise<QuoteView> {
    const prepared = await this.preparation.prepare(slug, input);
    const lines = this.pricedLines(prepared);
    const tax = prepared.tax;
    return {
      currency: prepared.currency,
      lines: prepared.lines.map((line) => ({ productId: line.product.id, name: line.product.name, quantity: line.quantity, unitPriceMinor: line.product.retailPriceMinor ?? 0 })),
      goodsMinor: prepared.goodsMinor,
      discountMinor: prepared.discount?.minor ?? 0,
      discountProblem: prepared.discountProblem,
      taxIncluded: tax.pricesIncludeTax,
      taxLabel: tax.model === "VAT" ? "VAT" : tax.model === "GST" ? "GST" : "Sales tax",
      options: prepared.options.map((option) => {
        const price = priceOrder({ lines, discountMinor: prepared.discount?.minor ?? 0, deliveryMinor: option.priceMinor, tax, region: input.shipTo.region, commissionBps: prepared.commissionBps });
        return { speed: option.speed, label: option.label, window: option.window, priceMinor: option.priceMinor, totalMinor: price.totalMinor, taxMinor: price.taxMinor };
      }),
    };
  }

  async start(slug: string, input: CheckoutInput, meta: RequestMeta): Promise<CheckoutStartedView> {
    await this.limiter.consume(PER_IP, meta.ip ?? "unknown");
    await this.limiter.consume(PER_EMAIL, input.buyerEmail);
    const prepared = await this.preparation.prepare(slug, input);
    if (input.discountCode && prepared.discountProblem) {
      throw Errors.validation({ discountCode: [prepared.discountProblem] });
    }
    const option = prepared.options.find((candidate) => candidate.speed === input.deliverySpeed);
    if (!option) {
      throw Errors.validation({ deliverySpeed: ["Choose one of the delivery options"] });
    }
    const price = priceOrder({
      lines: this.pricedLines(prepared),
      discountMinor: prepared.discount?.minor ?? 0,
      deliveryMinor: option.priceMinor,
      tax: prepared.tax,
      region: input.shipTo.region,
      commissionBps: prepared.commissionBps,
    });
    const { processor } = this.payments.forCountry(prepared.countryCode);
    const id = randomUUID();
    const reference = `SF-${prepared.countryCode}-${randomCode(8)}`;
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS);
    await this.prisma.$transaction(async (tx) => {
      if (prepared.discount && !(await this.discounts.redeem(tx, prepared.discount.id))) {
        throw Errors.validation({ discountCode: ["That code has been used up"] });
      }
      const buyer = await tx.buyerAccount.upsert({ where: { email: input.buyerEmail }, create: { email: input.buyerEmail, name: input.buyerName }, update: {} });
      await tx.storefrontOrder.create({
        data: {
          id,
          reference,
          vendorId: prepared.store.vendorId,
          countryCode: prepared.countryCode,
          currency: prepared.currency,
          buyerId: buyer.id,
          buyerEmail: input.buyerEmail,
          buyerName: input.buyerName,
          recipientEncrypted: this.repository.encryptShipTo(id, input.shipTo),
          recipientCity: input.shipTo.city,
          destinationCountryCode: input.shipTo.countryCode,
          goodsMinor: BigInt(price.goodsMinor),
          discountCodeId: prepared.discount?.id ?? null,
          discountMinor: BigInt(price.discountMinor),
          deliverySpeed: option.speed,
          deliveryMinor: BigInt(price.deliveryMinor),
          taxMinor: BigInt(price.taxMinor),
          taxIncluded: price.taxIncluded,
          totalMinor: BigInt(price.totalMinor),
          vendorShareMinor: BigInt(price.vendorShareMinor),
          platformShareMinor: BigInt(price.platformShareMinor),
          provider: processor.name,
          expiresAt,
          lines: {
            create: prepared.lines.map((line) => ({ productId: line.product.id, productName: line.product.name, quantity: line.quantity, unitPriceMinor: line.product.retailPriceMinor ?? 0 })),
          },
        },
      });
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: "storefront.checkout_started",
          resourceType: "storefront_order",
          resourceId: id,
          vendorId: prepared.store.vendorId,
          countryCode: prepared.countryCode,
          after: { reference, totalMinor: price.totalMinor },
          meta,
        },
        tx,
      );
    });
    const web = this.config.WEB_PUBLIC_URL;
    const session = await processor
      .createOrderCheckout({
        kind: "STORE",
        orderId: id,
        reference,
        storeName: prepared.store.displayName,
        currency: prepared.currency,
        totalMinor: price.totalMinor,
        itemCount: prepared.lines.reduce((total, line) => total + line.quantity, 0),
        customerEmail: input.buyerEmail,
        successUrl: `${web}/checkout/complete?order=${id}`,
        cancelUrl: `${web}/store/${prepared.store.slug}?checkout=cancelled`,
        expiresAt,
      })
      .catch(async () => {
        await this.prisma.storefrontOrder.update({ where: { id }, data: { status: "PAYMENT_FAILED" } });
        throw Errors.carrierFailed("We couldn't start the payment. Try again in a moment.");
      });
    await this.prisma.storefrontOrder.update({ where: { id }, data: { providerReference: session.providerReference } });
    return { reference, redirectUrl: session.redirectUrl };
  }

  async receipt(orderId: string): Promise<StorefrontOrderView> {
    const row = await this.prisma.storefrontOrder.findFirst({ where: { id: orderId, createdAt: { gt: new Date(Date.now() - RECEIPT_LINK_MS) } }, include: STOREFRONT_ORDER_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return this.repository.view(row, "RECEIPT");
  }

  async completeSandbox(reference: string): Promise<StorefrontOrderView> {
    const order = await this.prisma.storefrontOrder.findUnique({ where: { reference } });
    if (!order || order.provider !== "SANDBOX" || this.config.NODE_ENV === "production" || !order.providerReference) {
      throw Errors.notFound();
    }
    await this.events.handle("SANDBOX", order.countryCode, {
      kind: "ORDER_PAID",
      orderKind: "STORE",
      eventId: `sandbox_order_paid_${order.id}`,
      orderId: order.id,
      providerReference: order.providerReference,
      paymentId: `sandbox_payment_${order.id}`,
      amountMinor: Number(order.totalMinor),
      currency: order.currency,
      type: "sandbox.order_paid",
      payload: { reference },
    });
    return this.receipt(order.id);
  }

  private pricedLines(prepared: PreparedCheckout) {
    return prepared.lines.map((line) => ({ unitPriceMinor: line.product.retailPriceMinor ?? 0, quantity: line.quantity }));
  }
}
