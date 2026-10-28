import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { IdentityCheckStatus } from "../../../shared";
import {
  headerOf,
  type IdentityCheckProvider,
  type IdentityDecision,
  type IdentitySession,
  type IdentitySubject,
  type IdentityWebhookEvent,
  type WebhookHeaders,
  WebhookRejected,
} from "./identity-check.port";

export interface DiditSettings {
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
  apiUrl: string;
}

type Fetch = typeof fetch;

const TOLERANCE_SECONDS = 300;
const TIMEOUT_MS = 15_000;

const STATUSES: Record<string, IdentityCheckStatus> = { Approved: "APPROVED", Declined: "DECLINED", "In Review": "IN_REVIEW", Abandoned: "ABANDONED", Expired: "EXPIRED", "Kyc Expired": "EXPIRED" };

const SETTLED_REASONS: Partial<Record<IdentityCheckStatus, string>> = { ABANDONED: "the check wasn't finished", EXPIRED: "the check link expired" };

interface DiditPart {
  status?: string;
}

interface DiditIdVerification extends DiditPart {
  document_type?: string | null;
  issuing_state?: string | null;
  expiration_date?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}

interface DiditDecision {
  status?: string;
  id_verifications?: DiditIdVerification[] | null;
  liveness_checks?: DiditPart[] | null;
  face_matches?: DiditPart[] | null;
}

interface DiditWebhookBody {
  event_id?: string;
  session_id?: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function declinedParts(decision: DiditDecision): string[] {
  const declined = (parts: DiditPart[] | null | undefined) => (parts ?? []).some((part) => part.status === "Declined");
  return [
    declined(decision.id_verifications) ? "we couldn't verify your ID document" : null,
    declined(decision.liveness_checks) ? "the live selfie check didn't pass" : null,
    declined(decision.face_matches) ? "your face didn't match the photo on your ID" : null,
  ].filter((reason): reason is string => reason !== null);
}

function reasonFor(status: IdentityCheckStatus, decision: DiditDecision): string | null {
  if (status === "DECLINED") {
    return declinedParts(decision).join("; ") || "the check didn't pass";
  }
  return SETTLED_REASONS[status] ?? null;
}

export class DiditIdentityProvider implements IdentityCheckProvider {
  readonly name = "DIDIT";

  constructor(
    private readonly settings: DiditSettings,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async start(subject: IdentitySubject): Promise<IdentitySession> {
    const body = { workflow_id: this.settings.workflowId, vendor_data: `${subject.type.toLowerCase()}:${subject.id}`, callback: subject.returnUrl };
    const session = await this.request<{ session_id?: string; url?: string }>("/v3/session/", { method: "POST", body: JSON.stringify(body) });
    if (!session.session_id || !session.url) {
      throw new Error("Didit did not return a verification link");
    }
    return { sessionId: session.session_id, url: session.url };
  }

  async fetchDecision(sessionId: string): Promise<IdentityDecision> {
    const decision = await this.request<DiditDecision>(`/v3/session/${encodeURIComponent(sessionId)}/decision/`, { method: "GET" });
    const status = STATUSES[decision.status ?? ""] ?? "PENDING";
    const document = decision.id_verifications?.[0];
    const verifiedName = [document?.first_name, document?.last_name].filter(Boolean).join(" ") || document?.full_name || null;
    return {
      status,
      verifiedName,
      documentType: document?.document_type?.slice(0, 60) ?? null,
      issuingCountry: document?.issuing_state?.slice(0, 3) ?? null,
      documentExpiry: /^\d{4}-\d{2}-\d{2}$/.test(document?.expiration_date ?? "") ? document!.expiration_date! : null,
      reason: reasonFor(status, decision),
    };
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): IdentityWebhookEvent | null {
    const timestamp = Number(headerOf(headers, "x-timestamp"));
    if (!Number.isFinite(timestamp) || Math.abs(this.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
      throw new WebhookRejected();
    }
    const body = this.parse(rawBody);
    const signedCanonical = this.signedBy(canonicalJson(body), headers, ["x-signature-v2", "x-signature-v2-previous"]);
    if (!signedCanonical && !this.signedBy(rawBody, headers, ["x-signature", "x-signature-previous"])) {
      throw new WebhookRejected();
    }
    if (!body.session_id) {
      return null;
    }
    return { eventId: body.event_id ?? createHash("sha256").update(rawBody).digest("hex"), sessionId: body.session_id };
  }

  private parse(rawBody: Buffer): DiditWebhookBody {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new WebhookRejected();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new WebhookRejected();
    }
    return parsed;
  }

  private signedBy(content: string | Buffer, headers: WebhookHeaders, names: string[]): boolean {
    const expected = Buffer.from(createHmac("sha256", this.settings.webhookSecret).update(content).digest("hex"));
    return names.some((name) => {
      const given = Buffer.from(headerOf(headers, name) ?? "");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  }

  private async request<Result>(path: string, init: { method: string; body?: string }): Promise<Result> {
    const response = await this.http(`${this.settings.apiUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "x-api-key": this.settings.apiKey, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Didit answered ${response.status} for ${init.method} ${path.split("/").slice(0, 3).join("/")}`);
    }
    return (await response.json()) as Result;
  }
}
