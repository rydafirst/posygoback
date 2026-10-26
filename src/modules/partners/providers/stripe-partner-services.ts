import Stripe from "stripe";

import { type IdentityOutcome, type IdentityVerifier, type PayoutAccountRequest, type PayoutAccountSnapshot, type PayoutGateway, TransferError, WebhookRejected } from "./partner-services.port";

const TOLERANCE_SECONDS = 300;

function client(secretKey: string): Stripe {
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
}

function verifiedEvent(stripe: Stripe, rawBody: Buffer, signature: string, secret: string): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret, TOLERANCE_SECONDS);
  } catch {
    throw new WebhookRejected();
  }
}

export class StripeIdentityVerifier implements IdentityVerifier {
  readonly provider = "STRIPE_IDENTITY";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = client(secretKey);
  }

  async startSession(request: { partnerId: string; returnUrl: string }): Promise<{ sessionId: string; url: string }> {
    const session = await this.stripe.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      metadata: { partnerId: request.partnerId },
      return_url: request.returnUrl,
    });
    if (!session.url) {
      throw new Error("Stripe did not return a verification link");
    }
    return { sessionId: session.id, url: session.url };
  }

  async fetchOutcome(sessionId: string): Promise<IdentityOutcome> {
    const session = await this.stripe.identity.verificationSessions.retrieve(sessionId, { expand: ["verified_outputs"] });
    if (session.status === "verified") {
      const outputs = session.verified_outputs;
      const verifiedName = [outputs?.first_name, outputs?.last_name].filter(Boolean).join(" ");
      return { status: "VERIFIED", verifiedName: verifiedName || null };
    }
    if (session.status === "canceled" || (session.status === "requires_input" && session.last_error)) {
      return { status: "FAILED", reason: session.last_error?.reason ?? "The check was cancelled" };
    }
    return { status: "PENDING" };
  }

  parseWebhook(rawBody: Buffer, signature: string): string | null {
    const event = verifiedEvent(this.stripe, rawBody, signature, this.webhookSecret);
    return event.type.startsWith("identity.verification_session.") ? (event.data.object as Stripe.Identity.VerificationSession).id : null;
  }
}

export class StripeConnectGateway implements PayoutGateway {
  readonly provider = "STRIPE_CONNECT";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = client(secretKey);
  }

  async createAccount(request: PayoutAccountRequest): Promise<string> {
    const account = await this.stripe.accounts.create(
      {
        type: "express",
        country: request.countryCode,
        email: request.email,
        ...(request.ownerType === "PARTNER" ? { business_type: "individual" as const } : {}),
        capabilities: { transfers: { requested: true } },
        metadata: { ownerType: request.ownerType, ownerId: request.ownerId },
      },
      { idempotencyKey: `${request.ownerType.toLowerCase()}-account:${request.ownerId}` },
    );
    return account.id;
  }

  async onboardingLink(accountId: string, returnUrl: string): Promise<string> {
    const link = await this.stripe.accountLinks.create({ account: accountId, type: "account_onboarding", return_url: returnUrl, refresh_url: returnUrl });
    return link.url;
  }

  async fetchAccount(accountId: string): Promise<PayoutAccountSnapshot> {
    const account = await this.stripe.accounts.retrieve(accountId, { expand: ["external_accounts"] });
    const banks = (account.external_accounts?.data ?? []).filter((external): external is Stripe.BankAccount => external.object === "bank_account");
    const bank = banks.find((candidate) => candidate.default_for_currency) ?? banks[0];
    return { payoutsEnabled: account.payouts_enabled === true, bankSummary: bank ? `${bank.bank_name ?? "Bank account"} ••••${bank.last4}` : null, bankFingerprint: bank?.fingerprint ?? null };
  }

  async transfer(request: { accountId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<string> {
    try {
      const transfer = await this.stripe.transfers.create(
        { amount: request.amountMinor, currency: request.currency.toLowerCase(), destination: request.accountId },
        { idempotencyKey: request.idempotencyKey },
      );
      return transfer.id;
    } catch (error) {
      const definite = error instanceof Stripe.errors.StripeInvalidRequestError || error instanceof Stripe.errors.StripeCardError;
      throw new TransferError(error instanceof Error ? error.message : "The transfer failed", definite);
    }
  }

  parseWebhook(rawBody: Buffer, signature: string): string | null {
    const event = verifiedEvent(this.stripe, rawBody, signature, this.webhookSecret);
    return event.type === "account.updated" ? event.data.object.id : null;
  }
}
