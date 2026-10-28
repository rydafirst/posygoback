import Stripe from "stripe";

import {
  headerOf,
  type IdentityCheckProvider,
  type IdentityDecision,
  type IdentitySession,
  type IdentitySubject,
  pendingDecision,
  type WebhookHeaders,
  type IdentityWebhookEvent,
  WebhookRejected,
} from "./identity-check.port";

const TOLERANCE_SECONDS = 300;

export class StripeIdentityProvider implements IdentityCheckProvider {
  readonly name = "STRIPE_IDENTITY";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async start(subject: IdentitySubject): Promise<IdentitySession> {
    const session = await this.stripe.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      metadata: { subjectType: subject.type, subjectId: subject.id, ...(subject.type === "PARTNER" ? { partnerId: subject.id } : {}) },
      return_url: subject.returnUrl,
    });
    if (!session.url) {
      throw new Error("Stripe did not return a verification link");
    }
    return { sessionId: session.id, url: session.url };
  }

  async fetchDecision(sessionId: string): Promise<IdentityDecision> {
    const session = await this.stripe.identity.verificationSessions.retrieve(sessionId, { expand: ["verified_outputs"] });
    if (session.status === "verified") {
      const outputs = session.verified_outputs;
      const verifiedName = [outputs?.first_name, outputs?.last_name].filter(Boolean).join(" ");
      return { ...pendingDecision(), status: "APPROVED", verifiedName: verifiedName || null };
    }
    if (session.status === "canceled" || (session.status === "requires_input" && session.last_error)) {
      return { ...pendingDecision(), status: "DECLINED", reason: session.last_error?.reason ?? "The check was cancelled" };
    }
    return pendingDecision();
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): IdentityWebhookEvent | null {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, headerOf(headers, "stripe-signature") ?? "", this.webhookSecret, TOLERANCE_SECONDS);
    } catch {
      throw new WebhookRejected();
    }
    return event.type.startsWith("identity.verification_session.") ? { eventId: event.id, sessionId: (event.data.object as Stripe.Identity.VerificationSession).id } : null;
  }
}
