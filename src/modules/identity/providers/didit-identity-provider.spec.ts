import { createHmac } from "node:crypto";

import { canonicalJson, DiditIdentityProvider } from "./didit-identity-provider";
import { WebhookRejected } from "./identity-check.port";

const NOW = 1_790_000_000_000;
const provider = new DiditIdentityProvider({ apiKey: "key", workflowId: "workflow", webhookSecret: "secret", apiUrl: "https://didit.test" }, fetch, () => NOW);
const sign = (content: string) => createHmac("sha256", "secret").update(content).digest("hex");

describe("Didit webhooks", () => {
  const body = Buffer.from('{ "status": "Approved", "session_id": "s-1", "event_id": "e-1", "decision": { "score": 100.0, "name": "Zoë" } }');
  const timestamp = String(NOW / 1000);

  it("builds the canonical JSON with sorted keys, no spaces and Unicode kept", () => {
    expect(canonicalJson(JSON.parse(body.toString()))).toBe('{"decision":{"name":"Zoë","score":100},"event_id":"e-1","session_id":"s-1","status":"Approved"}');
  });

  it("accepts the canonical signature and returns the event", () => {
    const signature = sign(canonicalJson(JSON.parse(body.toString())));
    expect(provider.verifyWebhook(body, { "x-timestamp": timestamp, "x-signature-v2": signature })).toEqual({ eventId: "e-1", sessionId: "s-1" });
  });

  it("falls back to the raw body signature", () => {
    expect(provider.verifyWebhook(body, { "x-timestamp": timestamp, "x-signature": sign(body.toString()) })).toEqual({ eventId: "e-1", sessionId: "s-1" });
  });

  it("rejects stale or unsigned deliveries", () => {
    const signature = sign(canonicalJson(JSON.parse(body.toString())));
    expect(() => provider.verifyWebhook(body, { "x-timestamp": String(NOW / 1000 - 301), "x-signature-v2": signature })).toThrow(WebhookRejected);
    expect(() => provider.verifyWebhook(body, { "x-timestamp": timestamp, "x-signature-v2": "0".repeat(64) })).toThrow(WebhookRejected);
    expect(() => provider.verifyWebhook(Buffer.from("not json"), { "x-timestamp": timestamp })).toThrow(WebhookRejected);
  });
});
