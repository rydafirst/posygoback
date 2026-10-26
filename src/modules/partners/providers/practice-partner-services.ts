import { createHash, randomUUID } from "node:crypto";

import type { IdentityOutcome, IdentityVerifier, PayoutAccountSnapshot, PayoutGateway } from "./partner-services.port";

export class PracticeIdentityVerifier implements IdentityVerifier {
  readonly provider = "PRACTICE";

  startSession(request: { partnerId: string; returnUrl: string }): Promise<{ sessionId: string; url: string }> {
    return Promise.resolve({ sessionId: `practice_vs_${randomUUID()}`, url: request.returnUrl });
  }

  fetchOutcome(): Promise<IdentityOutcome> {
    return Promise.resolve({ status: "VERIFIED", verifiedName: null });
  }

  parseWebhook(): string | null {
    return null;
  }
}

export class PracticePayoutGateway implements PayoutGateway {
  readonly provider = "PRACTICE";

  createAccount(): Promise<string> {
    return Promise.resolve(`practice_acct_${randomUUID()}`);
  }

  onboardingLink(_accountId: string, returnUrl: string): Promise<string> {
    return Promise.resolve(returnUrl);
  }

  fetchAccount(): Promise<PayoutAccountSnapshot> {
    return Promise.resolve({ payoutsEnabled: true, bankSummary: "Practice Bank ••••4242", bankFingerprint: "practice" });
  }

  transfer(request: { idempotencyKey: string }): Promise<string> {
    return Promise.resolve(`practice_tr_${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 24)}`);
  }

  parseWebhook(): string | null {
    return null;
  }
}
