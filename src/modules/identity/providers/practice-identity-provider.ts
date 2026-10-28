import { randomUUID } from "node:crypto";

import type { IdentityCheckProvider, IdentityDecision, IdentitySession, IdentitySubject } from "./identity-check.port";

export class PracticeIdentityProvider implements IdentityCheckProvider {
  readonly name = "PRACTICE";

  start(subject: IdentitySubject): Promise<IdentitySession> {
    return Promise.resolve({ sessionId: `practice_vs_${randomUUID()}`, url: subject.returnUrl });
  }

  fetchDecision(): Promise<IdentityDecision> {
    return Promise.resolve({ status: "APPROVED", verifiedName: null, documentType: null, issuingCountry: null, documentExpiry: null, reason: null });
  }

  verifyWebhook(): null {
    return null;
  }
}
