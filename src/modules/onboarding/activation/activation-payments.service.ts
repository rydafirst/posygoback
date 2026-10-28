import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { PLATFORM_NAME } from "../../../common/brand/brand";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, VendorActivationPayment } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { type ActivationPaymentView, type ActivationStarted, activationFeeOf, type VendorActivationView } from "../../../shared";
import { UsersRepository } from "../../auth/users.repository";
import { type OrderPaymentEvent, type OrderPaymentHandler, OrderPaymentRouter, type PaymentOutcome, type PaymentReversalEvent } from "../../finance/payments/order-payment.router";
import { PaymentAccountsService, type ResolvedAccount } from "../../finance/payments/payment-accounts.service";
import { PaymentEventsService } from "../../finance/payments/payment-events.service";
import { vendorIdOf } from "../scope";
import { VendorActivationService } from "../vendor-activation.service";
import { ActivationNoticesService } from "./activation-notices.service";
import { activationStateOf, isAwaitingActivation } from "./activation-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const outcome = (text: string, followUps: PaymentOutcome["followUps"] = []): PaymentOutcome => ({ outcome: text, followUps });

type Prepared = { live: true } | { live: false; payment: VendorActivationPayment };

function toView(payment: VendorActivationPayment): ActivationPaymentView {
  return {
    id: payment.id,
    status: payment.status,
    feeMinor: Number(payment.feeMinor),
    currency: payment.currency,
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ActivationPaymentsService implements OrderPaymentHandler, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: OrderPaymentRouter,
    private readonly accounts: PaymentAccountsService,
    private readonly events: PaymentEventsService,
    private readonly activation: VendorActivationService,
    private readonly notices: ActivationNoticesService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.router.use("ACTIVATION", this);
  }

  async view(principal: AuthPrincipal): Promise<VendorActivationView> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, include: { country: true } });
    if (!vendor) {
      throw Errors.notFound();
    }
    const latest = await this.prisma.vendorActivationPayment.findFirst({ where: { vendorId }, orderBy: { createdAt: "desc" } });
    const state = activationStateOf(vendor);
    return {
      state,
      feeMinor: state === "DUE" ? activationFeeOf(vendor.country.config as { activationFeeMinor?: unknown }) : null,
      currency: vendor.country.currency,
      payment: latest ? toView(latest) : null,
    };
  }

  async start(principal: AuthPrincipal, meta: RequestMeta): Promise<ActivationStarted> {
    const vendorId = vendorIdOf(principal);
    const resolved = this.accounts.find(principal.countryCode ?? "");
    if (!resolved) {
      throw Errors.invalidTransition("Card payments aren't available in your market yet. Contact us to activate your account.");
    }
    const prepared = await this.prisma.$transaction((tx) => this.prepare(tx, principal, vendorId, resolved, meta));
    if (prepared.live) {
      await this.notices.waived(vendorId);
      return { live: true, paymentId: null, redirectUrl: null };
    }
    const { payment } = prepared;
    const owner = await this.users.findById(principal.userId);
    const web = new URL(this.config.WEB_PUBLIC_URL).origin;
    const session = await resolved.processor
      .createActivationCheckout({
        paymentId: payment.id,
        currency: payment.currency,
        amountMinor: Number(payment.feeMinor),
        description: `${PLATFORM_NAME} activation fee`,
        customerEmail: owner?.email ?? "",
        successUrl: `${web}/verification?activation=${payment.id}`,
        cancelUrl: `${web}/verification?activation=${payment.id}&cancelled=1`,
      })
      .catch(() => {
        throw Errors.carrierFailed("We couldn't start the payment. Try again in a moment.");
      });
    await this.prisma.vendorActivationPayment.update({ where: { id: payment.id }, data: { providerReference: session.providerReference } });
    return { live: false, paymentId: payment.id, redirectUrl: session.redirectUrl };
  }

  async completeSandbox(principal: AuthPrincipal, paymentId: string): Promise<VendorActivationView> {
    const payment = await this.prisma.vendorActivationPayment.findFirst({ where: { id: paymentId, vendorId: vendorIdOf(principal) } });
    if (!payment || payment.processor !== "SANDBOX" || this.config.NODE_ENV === "production" || !payment.providerReference) {
      throw Errors.notFound();
    }
    await this.events.handle("SANDBOX", payment.countryCode, {
      kind: "ORDER_PAID",
      orderKind: "ACTIVATION",
      eventId: `sandbox_activation_paid_${payment.id}`,
      orderId: payment.id,
      providerReference: payment.providerReference,
      paymentId: `sandbox_payment_${payment.id}`,
      amountMinor: Number(payment.feeMinor),
      currency: payment.currency,
      type: "sandbox.activation_paid",
      payload: { paymentId },
    });
    return this.view(principal);
  }

  async orderEvent(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: OrderPaymentEvent): Promise<PaymentOutcome> {
    if (!UUID.test(event.orderId) || !(await lockRow(tx, "vendorActivationPayments", event.orderId))) {
      return outcome("unknown activation payment");
    }
    const payment = await tx.vendorActivationPayment.findUniqueOrThrow({ where: { id: event.orderId } });
    if (event.kind === "ORDER_CLOSED") {
      const closed = await tx.vendorActivationPayment.updateMany({
        where: { id: payment.id, processor: provider, countryCode: accountKey, providerReference: event.providerReference, status: "PENDING" },
        data: { status: event.outcome, closedAt: new Date() },
      });
      return outcome(closed.count > 0 ? event.outcome.toLowerCase() : "nothing to close");
    }
    const problem = this.mismatch(payment, provider, accountKey, event);
    if (problem) {
      await this.reject(tx, payment, event.eventId, problem);
      return outcome(`rejected: ${problem}`, this.giveBack(accountKey, event));
    }
    if (payment.status === "PAID" || payment.status === "REFUNDED") {
      if (payment.providerPaymentId === event.paymentId) {
        return outcome("already paid");
      }
      await this.reject(tx, payment, event.eventId, "paid twice");
      return outcome("rejected: paid twice", this.giveBack(accountKey, event));
    }
    await lockRow(tx, "vendors", payment.vendorId);
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: payment.vendorId } });
    const paidAt = new Date();
    const settled = { paidAt, paidMinor: BigInt(event.amountMinor), providerPaymentId: event.paymentId };
    if (!isAwaitingActivation(vendor)) {
      await tx.vendorActivationPayment.update({ where: { id: payment.id }, data: { ...settled, status: "REFUNDED" } });
      await this.reject(tx, payment, event.eventId, "account no longer waiting for activation");
      return outcome("refunded: account no longer waiting for activation", this.giveBack(accountKey, event));
    }
    await tx.vendorActivationPayment.update({ where: { id: payment.id }, data: { ...settled, status: "PAID" } });
    await this.activation.goLive(payment.vendorId, payment.countryCode, tx, { activationPaymentId: payment.id, feeMinor: Number(payment.feeMinor) });
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "activation.paid",
        resourceType: "vendor_activation_payment",
        resourceId: payment.id,
        vendorId: payment.vendorId,
        countryCode: payment.countryCode,
        after: { feeMinor: Number(payment.feeMinor), currency: payment.currency, paymentId: event.paymentId },
      },
      tx,
    );
    const paid = { paymentId: payment.id, vendorId: payment.vendorId, countryCode: payment.countryCode, feeMinor: Number(payment.feeMinor), currency: payment.currency, paidAt };
    return outcome("paid", [() => this.notices.paid(paid)]);
  }

  async paymentReversal(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: PaymentReversalEvent): Promise<PaymentOutcome | null> {
    const payment = event.paymentId ? await tx.vendorActivationPayment.findFirst({ where: { processor: provider, countryCode: accountKey, providerPaymentId: event.paymentId } }) : null;
    if (!payment) {
      return null;
    }
    const action = event.kind === "PAYMENT_REFUNDED" ? "activation.refund_seen" : `activation.dispute_${event.stage.toLowerCase()}`;
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action,
        resourceType: "vendor_activation_payment",
        resourceId: payment.id,
        vendorId: payment.vendorId,
        countryCode: payment.countryCode,
        after: { eventId: event.eventId, currency: event.currency },
      },
      tx,
    );
    return outcome(action);
  }

  private async prepare(tx: Prisma.TransactionClient, principal: AuthPrincipal, vendorId: string, resolved: ResolvedAccount, meta: RequestMeta): Promise<Prepared> {
    await lockRow(tx, "vendors", vendorId);
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { country: true } });
    if (!isAwaitingActivation(vendor)) {
      throw Errors.invalidTransition(vendor.status === "ACTIVE" ? "Your account is already live." : "Finish verifying your business and accept the agreement first.");
    }
    const feeMinor = activationFeeOf(vendor.country.config as { activationFeeMinor?: unknown });
    if (feeMinor === 0) {
      await this.activation.goLive(vendorId, vendor.countryCode, tx, { feeMinor });
      return { live: true };
    }
    const payment = await tx.vendorActivationPayment.create({
      data: { vendorId, countryCode: vendor.countryCode, processor: resolved.processor.name, currency: vendor.country.currency, feeMinor: BigInt(feeMinor) },
    });
    await this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action: "activation.checkout_started",
        resourceType: "vendor_activation_payment",
        resourceId: payment.id,
        vendorId,
        countryCode: vendor.countryCode,
        after: { feeMinor, currency: payment.currency },
        meta,
      },
      tx,
    );
    return { live: false, payment };
  }

  private mismatch(payment: VendorActivationPayment, provider: string, accountKey: string, event: Extract<OrderPaymentEvent, { kind: "ORDER_PAID" }>): string | null {
    if (payment.processor !== provider || payment.countryCode !== accountKey || payment.providerReference !== event.providerReference) {
      return "checkout does not match";
    }
    if (payment.currency !== event.currency || Number(payment.feeMinor) !== event.amountMinor) {
      return "amount or currency does not match";
    }
    return null;
  }

  private giveBack(accountKey: string, event: OrderPaymentEvent): PaymentOutcome["followUps"] {
    if (event.kind !== "ORDER_PAID") {
      return [];
    }
    return [
      async () => {
        await this.accounts.forCountry(accountKey).processor.refund({ paymentId: event.paymentId, amountMinor: event.amountMinor, idempotencyKey: `activation-stray:${event.paymentId}` });
      },
    ];
  }

  private async reject(tx: Prisma.TransactionClient, payment: VendorActivationPayment, eventId: string, reason: string): Promise<void> {
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "payment.rejected",
        resourceType: "vendor_activation_payment",
        resourceId: payment.id,
        vendorId: payment.vendorId,
        countryCode: payment.countryCode,
        after: { reason, eventId },
      },
      tx,
    );
  }
}
