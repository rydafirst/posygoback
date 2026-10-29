import { identityProviderOf } from "./config.schema";

const STRIPE = { provider: "STRIPE" as const, secretKey: "sk_test_x", identityWebhookSecret: "whsec_x", connectWebhookSecret: "whsec_y", testMode: true };
const DIDIT = { DIDIT_API_KEY: "key", DIDIT_WORKFLOW_ID: "4f0bde3c-1f6e-4c56-9e70-0c5f8b6f1a11", DIDIT_WEBHOOK_SECRET: "secret" };
const NO_DIDIT = { DIDIT_API_KEY: "", DIDIT_WORKFLOW_ID: "", DIDIT_WEBHOOK_SECRET: "" };

describe("identityProviderOf", () => {
  it("prefers Didit when it is set up and nothing is chosen", () => {
    expect(identityProviderOf({ IDENTITY_PROVIDER: "", ...DIDIT, PARTNER_SERVICES: STRIPE })).toBe("didit");
  });

  it("keeps Stripe Identity working when Didit isn't set up", () => {
    expect(identityProviderOf({ IDENTITY_PROVIDER: "", ...NO_DIDIT, PARTNER_SERVICES: STRIPE })).toBe("stripe");
    expect(identityProviderOf({ IDENTITY_PROVIDER: "stripe", ...DIDIT, PARTNER_SERVICES: STRIPE })).toBe("stripe");
  });

  it("falls back to practice checks when the chosen provider has no settings", () => {
    expect(identityProviderOf({ IDENTITY_PROVIDER: "didit", ...NO_DIDIT, PARTNER_SERVICES: STRIPE })).toBe("practice");
    expect(identityProviderOf({ IDENTITY_PROVIDER: "stripe", ...NO_DIDIT, PARTNER_SERVICES: { provider: "PRACTICE" } })).toBe("practice");
  });
});
