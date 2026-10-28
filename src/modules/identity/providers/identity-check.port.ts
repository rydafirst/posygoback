import type { IdentityCheckStatus } from "../../../shared";

export type IdentitySubjectType = "VENDOR" | "PARTNER";

export interface IdentitySubject {
  type: IdentitySubjectType;
  id: string;
  returnUrl: string;
}

export interface IdentitySession {
  sessionId: string;
  url: string;
}

export interface IdentityDecision {
  status: IdentityCheckStatus;
  verifiedName: string | null;
  documentType: string | null;
  issuingCountry: string | null;
  documentExpiry: string | null;
  reason: string | null;
}

export interface IdentityWebhookEvent {
  eventId: string;
  sessionId: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface IdentityCheckProvider {
  readonly name: string;
  start(subject: IdentitySubject): Promise<IdentitySession>;
  fetchDecision(sessionId: string): Promise<IdentityDecision>;
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): IdentityWebhookEvent | null;
}

export class WebhookRejected extends Error {}

export const IDENTITY_CHECK_PROVIDER = Symbol("IDENTITY_CHECK_PROVIDER");

export function pendingDecision(): IdentityDecision {
  return { status: "PENDING", verifiedName: null, documentType: null, issuingCountry: null, documentExpiry: null, reason: null };
}

export function headerOf(headers: WebhookHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
