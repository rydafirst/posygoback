export { WebhookRejected } from "../../identity/providers/identity-check.port";

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

export const PAYOUT_GATEWAY = Symbol("PAYOUT_GATEWAY");
