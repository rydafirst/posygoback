import { z } from "zod";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const secret = (minBytes: number) =>
  z
    .string()
    .regex(BASE64, "Must be base64 encoded")
    .refine((value) => Buffer.from(value, "base64").length >= minBytes && !value.startsWith("replace"), `Must be at least ${minBytes} random bytes, base64 encoded`);

const encryptionKeys = z
  .string()
  .refine((raw) => raw.split(",").every((pair) => BASE64.test(pair.split(":")[1]?.trim() ?? "")), "Keys must be base64 encoded")
  .transform((raw) =>
    Object.fromEntries(
      raw.split(",").map((pair) => {
        const [version, key] = pair.split(":");
        return [version?.trim() ?? "", Buffer.from(key?.trim() ?? "", "base64")];
      }),
    ),
  )
  .refine((keys) => Object.entries(keys).every(([version, key]) => /^v\d+$/.test(version) && key.length === 32), "Use the form v1:<32 bytes base64>,v2:<32 bytes base64>");

const paymentAccountSchema = z.discriminatedUnion("processor", [
  z.object({
    processor: z.literal("STRIPE"),
    secretKey: z.string().regex(/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/, "Use a Stripe secret or restricted key"),
    webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/, "Use the endpoint's webhook signing secret"),
    feePercentBps: z.number().int().min(0).max(1000),
    fixedFeeMinor: z.number().int().min(0).max(1000),
  }),
  z.object({ processor: z.literal("SANDBOX"), feePercentBps: z.number().int().min(0).max(1000), fixedFeeMinor: z.number().int().min(0).max(1000) }),
]);

function jsonRecord<Value extends z.ZodType>(name: string, value: Value) {
  return z
    .string()
    .default("{}")
    .transform((raw, context) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: `${name} must be JSON` });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string().regex(/^[A-Z]{2}$/), value));
}

const paymentAccounts = jsonRecord("PAYMENT_ACCOUNTS", paymentAccountSchema);

const carrierAccountSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("SHIPPO"),
    apiKey: z.string().regex(/^shippo_(live|test)_[A-Za-z0-9]+$/, "Use a Shippo API token"),
    webhookToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "Use a random token of at least 32 letters and numbers"),
    senderPhone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/),
    senderEmail: z.string().email(),
  }),
  z.object({ provider: z.literal("SANDBOX") }),
]);

const carrierAccounts = jsonRecord("CARRIER_ACCOUNTS", carrierAccountSchema);

export type CarrierAccount = z.infer<typeof carrierAccountSchema>;

const partnerServicesSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("STRIPE"),
    secretKey: z.string().regex(/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/, "Use a Stripe secret key"),
    identityWebhookSecret: z.string().startsWith("whsec_"),
    connectWebhookSecret: z.string().startsWith("whsec_"),
  }),
  z.object({ provider: z.literal("PRACTICE") }),
]);

export type PartnerServicesConfig = z.infer<typeof partnerServicesSchema>;

const partnerServices = z
  .string()
  .default('{"provider":"PRACTICE"}')
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "PARTNER_SERVICES must be JSON" });
      return z.NEVER;
    }
  })
  .pipe(partnerServicesSchema);

export type PaymentAccount = z.infer<typeof paymentAccountSchema>;

export const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PUBLIC_URL: z.string().url(),
    WEB_PUBLIC_URL: z.string().url(),
    DATABASE_URL: z.string().startsWith("postgres"),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string().startsWith("redis"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    CLIENT_IP_HEADER: z
      .string()
      .toLowerCase()
      .regex(/^[a-z0-9-]*$/)
      .refine((header) => header !== "x-forwarded-for", "Use TRUST_PROXY_HOPS for X-Forwarded-For; this setting is for single-value headers such as cf-connecting-ip")
      .default(""),
    JWT_ACCESS_SECRET: secret(48),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    MFA_CHALLENGE_SECRET: secret(48),
    FIELD_ENCRYPTION_KEYS: encryptionKeys,
    FIELD_ENCRYPTION_ACTIVE_KEY: z.string().regex(/^v\d+$/),
    BLIND_INDEX_KEY: secret(32),
    COOKIE_DOMAIN: z.string().default(""),
    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_REGION: z.string().min(1),
    STORAGE_BUCKET: z.string().min(3),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    EMAIL_TRANSPORT: z.enum(["log", "memory"]).default("log"),
    PASSWORD_BREACH_CHECK: z.enum(["hibp", "off"]).default("hibp"),
    AUTH_TEST_SHORTCUTS: z
      .enum(["on", "off"])
      .default("off")
      .transform((value) => value === "on"),
    PAYMENT_ACCOUNTS: paymentAccounts,
    CARRIER_ACCOUNTS: carrierAccounts,
    PARTNER_SERVICES: partnerServices,
    JOBS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
  })
  .refine((config) => config.FIELD_ENCRYPTION_KEYS[config.FIELD_ENCRYPTION_ACTIVE_KEY], {
    message: "FIELD_ENCRYPTION_ACTIVE_KEY must name one of FIELD_ENCRYPTION_KEYS",
    path: ["FIELD_ENCRYPTION_ACTIVE_KEY"],
  })
  .refine((config) => config.NODE_ENV !== "production" || !config.AUTH_TEST_SHORTCUTS, { message: "Sign-in shortcuts can't be turned on in production", path: ["AUTH_TEST_SHORTCUTS"] })
  .refine((config) => config.NODE_ENV !== "production" || config.EMAIL_TRANSPORT !== "log", { message: "A real email transport is required in production", path: ["EMAIL_TRANSPORT"] })
  .refine((config) => config.NODE_ENV !== "production" || config.TRUST_PROXY_HOPS > 0 || config.CLIENT_IP_HEADER !== "", {
    message: "Production runs behind a proxy: set TRUST_PROXY_HOPS or CLIENT_IP_HEADER so rate limits see real client addresses",
    path: ["TRUST_PROXY_HOPS"],
  })
  .refine((config) => config.NODE_ENV !== "production" || Object.values(config.PAYMENT_ACCOUNTS).every((account) => account.processor !== "SANDBOX"), {
    message: "The sandbox payment processor can't be used in production",
    path: ["PAYMENT_ACCOUNTS"],
  })
  .refine((config) => config.NODE_ENV !== "production" || Object.values(config.PAYMENT_ACCOUNTS).every((account) => account.processor !== "STRIPE" || account.secretKey.includes("_live_")), {
    message: "Production needs live Stripe keys",
    path: ["PAYMENT_ACCOUNTS"],
  })
  .refine((config) => config.NODE_ENV !== "production" || Object.values(config.CARRIER_ACCOUNTS).every((account) => account.provider === "SHIPPO" && account.apiKey.startsWith("shippo_live_")), {
    message: "Production needs live carrier accounts; the sandbox carrier and test tokens are for development",
    path: ["CARRIER_ACCOUNTS"],
  })
  .refine((config) => config.NODE_ENV !== "production" || (config.PARTNER_SERVICES.provider === "STRIPE" && config.PARTNER_SERVICES.secretKey.includes("_live_")), {
    message: "Partner identity checks and payouts need a live Stripe key in production",
    path: ["PARTNER_SERVICES"],
  })
  .refine((config) => config.NODE_ENV !== "production" || config.API_PUBLIC_URL.startsWith("https://"), { message: "Production must be served over HTTPS", path: ["API_PUBLIC_URL"] });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  return parsed.data;
}
