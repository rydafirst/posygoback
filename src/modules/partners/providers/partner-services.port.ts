export type IdentityOutcome = { status: "VERIFIED"; verifiedName: string | null } | { status: "PENDING" } | { status: "FAILED"; reason: string };

export interface IdentityVerifier {
  readonly provider: string;
  startSession(request: { partnerId: string; returnUrl: string }): Promise<{ sessionId: string; url: string }>;
  fetchOutcome(sessionId: string): Promise<IdentityOutcome>;
  parseWebhook(rawBody: Buffer, signature: string): string | null;
}

export interface PayoutAccountSnapshot {
  payoutsEnabled: boolean;
  bankSummary: string | null;
  bankFingerprint: string | null;
}

export interface PayoutAccountRequest {
  ownerType: "PARTNER" | "VENDOR";
  ownerId: string;
  email: string;
  countryCode: string;
}

export class TransferError extends Error {
  constructor(
    message: string,
    readonly definite: boolean,
  ) {
    super(message);
  }
}

export interface PayoutGateway {
  readonly provider: string;
  createAccount(request: PayoutAccountRequest): Promise<string>;
  onboardingLink(accountId: string, returnUrl: string): Promise<string>;
  fetchAccount(accountId: string): Promise<PayoutAccountSnapshot>;
  transfer(request: { accountId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<string>;
  parseWebhook(rawBody: Buffer, signature: string): string | null;
}

export class WebhookRejected extends Error {}

export const IDENTITY_VERIFIER = Symbol("IDENTITY_VERIFIER");
export const PAYOUT_GATEWAY = Symbol("PAYOUT_GATEWAY");
