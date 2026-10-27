import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SEED_COUNTRIES, SEED_FEE_SCHEDULES } from "../src/shared";
import { argon2id, hash } from "argon2";
import Redis from "ioredis";
import { Pool } from "pg";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { loadConfig } from "../src/config/config.schema";
import { InMemoryEmailSender } from "../src/infrastructure/email/email.adapters";
import { EMAIL_TRANSPORT } from "../src/infrastructure/email/email.port";
import { InMemoryObjectStorage } from "../src/modules/files/storage/in-memory-object-storage";
import { OBJECT_STORAGE } from "../src/modules/files/storage/object-storage.port";

export const WEB_ORIGIN = "http://localhost:3000";
const MIGRATIONS = join(__dirname, "../prisma/migrations");
export const CARRIER_WEBHOOK_TOKEN = "gfnTestWebhookToken0123456789abcdefABCDEF";
export const SUPER_ADMIN = { email: "root@gfn.test", password: "correct horse battery staple" };

Object.assign(process.env, parseEnv(readFileSync(join(__dirname, "../.env"), "utf8")), {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://gfn:gfn_local_only@localhost:5432/gfn_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://:gfn_local_only@localhost:6379/1",
  EMAIL_TRANSPORT: "memory",
  SUPPORT_EMAIL: "help@gfn.test",
  CLIENT_IP_HEADER: "x-test-client-ip",
  PASSWORD_BREACH_CHECK: "off",
  WEB_PUBLIC_URL: WEB_ORIGIN,
  JOBS_ENABLED: "false",
  PAYMENT_ACCOUNTS: JSON.stringify({
    GB: { processor: "SANDBOX", feePercentBps: 450, fixedFeeMinor: 30 },
    US: { processor: "STRIPE", secretKey: "sk_test_gfnTestOnly", webhookSecret: "whsec_gfnTestOnly", feePercentBps: 290, fixedFeeMinor: 30 },
  }),
  CARRIER_ACCOUNTS: JSON.stringify({
    GB: { provider: "SHIPPO", apiKey: "shippo_test_gfnTestOnly", webhookToken: CARRIER_WEBHOOK_TOKEN, senderPhone: "+44 161 000 0000", senderEmail: "dispatch@gfn.test" },
    US: { provider: "SANDBOX" },
  }),
});

export async function resetDatabase(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    for (const migration of readdirSync(MIGRATIONS)
      .filter((name) => /^\d/.test(name))
      .sort()) {
      await pool.query(readFileSync(join(MIGRATIONS, migration, "migration.sql"), "utf8"));
    }
    for (const country of SEED_COUNTRIES) {
      await pool.query("INSERT INTO countries (code, name, currency, status, config) VALUES ($1, $2, $3, 'LIVE', $4)", [country.code, country.name, country.currency, JSON.stringify(country.config)]);
    }
    for (const [countryCode, schedule] of Object.entries(SEED_FEE_SCHEDULES)) {
      await pool.query("INSERT INTO fee_schedules (country_code, version, status, schedule, note) VALUES ($1, 1, 'ACTIVE', $2, 'Test prices')", [countryCode, JSON.stringify(schedule)]);
    }
    await pool.query(
      `INSERT INTO shipping_lanes (origin_country_code, destination_country_code, enabled, customs_required)
       VALUES ('GB', 'GB', true, false), ('GB', 'US', true, true)`,
    );
    await pool.query("INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES ($1, $2, 'SUPER_ADMIN', 'ACTIVE', now())", [
      SUPER_ADMIN.email,
      await hash(SUPER_ADMIN.password, { type: argon2id }),
    ]);
  } finally {
    await pool.end();
  }
  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}

export interface TestApp {
  app: INestApplication;
  email: InMemoryEmailSender;
  storage: InMemoryObjectStorage;
  http: () => ReturnType<typeof request>;
}

export async function startApp(shared?: { email: InMemoryEmailSender; storage: InMemoryObjectStorage }, overrides: ReadonlyArray<[symbol, unknown]> = []): Promise<TestApp> {
  const email = shared?.email ?? new InMemoryEmailSender();
  const storage = shared?.storage ?? new InMemoryObjectStorage();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_TRANSPORT)
    .useValue(email)
    .overrideProvider(OBJECT_STORAGE)
    .useValue(storage);
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true, logger: process.env.DEBUG_E2E ? ["error"] : false });
  configureApp(app, loadConfig());
  await app.init();
  return { app, email, storage, http: () => request(app.getHttpServer()) };
}

export function codeFrom(text: string): string {
  const match = /\b(\d{8})\b/.exec(text);
  if (!match) {
    throw new Error(`No code in: ${text}`);
  }
  return match[1]!;
}

export function refreshCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith("gfn_rt="));
  if (!cookie) {
    throw new Error("No refresh cookie set");
  }
  return cookie.split(";")[0]!;
}

export async function signUpAndVerify(test: TestApp, email: string, password = "a long enough password", countryCode = "GB"): Promise<{ accessToken: string; cookie: string }> {
  await test.http().post("/v1/auth/signup").send({ email, password, businessName: "Acme Goods", countryCode, acceptTerms: true }).expect(202);
  const code = codeFrom(test.email.lastTo(email)!.text);
  const verified = await test.http().post("/v1/auth/verify-email").send({ email, code, password }).expect(200);
  return { accessToken: verified.body.accessToken, cookie: refreshCookie(verified.headers["set-cookie"]) };
}

export async function flushRateLimits(): Promise<void> {
  const redis = new Redis(loadConfig().REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}

export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

export async function uploadVerifiedFile(test: TestApp, accessToken: string, purpose = "KYC_DOCUMENT"): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const created = await test.http().post("/v1/files/uploads").set(auth).send({ purpose, contentType: "image/png", sizeBytes: PNG_BYTES.length }).expect(201);
  test.storage.put(String(created.body.upload.url).replace("memory://", ""), PNG_BYTES);
  await test.http().post(`/v1/files/${created.body.fileId}/confirm`).set(auth).expect(200);
  return created.body.fileId as string;
}

export async function createStaff(test: TestApp, email: string, role: string, countryCode: string | null = null): Promise<string> {
  const password = "staff member password";
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  await pool.query("INSERT INTO users (email, password_hash, role, status, email_verified_at, country_code) VALUES ($1, $2, $3, 'ACTIVE', now(), $4)", [
    email,
    await hash(password, { type: argon2id }),
    role,
    countryCode,
  ]);
  await pool.end();
  const login = await test.http().post("/v1/auth/login").send({ email, password }).expect(200);
  return enrolMfa(test, email, login.body.accessToken as string);
}

export async function enrolMfa(test: TestApp, email: string, accessToken: string): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const start = await test.http().post("/v1/auth/mfa/enrolment").set(auth).expect(200);
  const emailCode = codeFrom(test.email.lastTo(email)!.text);
  const { authenticator } = await import("otplib");
  const confirmed = await test
    .http()
    .post("/v1/auth/mfa/enrolment/confirm")
    .set(auth)
    .send({ code: authenticator.generate(start.body.secret), emailCode })
    .expect(200);
  return confirmed.body.accessToken as string;
}

export async function insertLegalDocument(countryCode: string, kind: string, version: string): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  await pool.query("INSERT INTO legal_documents (country_code, kind, version, title, body) VALUES ($1, $2, $3, $4, $5)", [
    countryCode,
    kind,
    version,
    `${kind} ${version}`,
    "Test agreement body that is long enough to be accepted by validation rules.",
  ]);
  await pool.end();
}

export async function makeVendorTrade(vendorId: string, countryCode = "GB"): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    await pool.query("UPDATE vendors SET status = 'ACTIVE' WHERE id = $1", [vendorId]);
    await pool.query(
      `INSERT INTO agreement_acceptances (vendor_id, legal_document_id, accepted_by)
       SELECT $1, d.id, u.id FROM legal_documents d, users u
       WHERE d.country_code = $2 AND d.kind = 'VENDOR_AGREEMENT' AND u.vendor_id = $1 AND u.role = 'VENDOR_OWNER'
       ON CONFLICT DO NOTHING`,
      [vendorId, countryCode],
    );
  } finally {
    await pool.end();
  }
}

export async function fundWallet(vendorId: string, amountMinor: number, currency = "GBP"): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    const wallet = await pool.query<{ id: string; balance_minor: string }>(
      `INSERT INTO wallets (vendor_id, currency) VALUES ($1, $2)
       ON CONFLICT (vendor_id, currency) DO UPDATE SET currency = EXCLUDED.currency RETURNING id, balance_minor`,
      [vendorId, currency],
    );
    const { id, balance_minor } = wallet.rows[0]!;
    await pool.query("INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) VALUES ($1, $2, 'DEPOSIT', $3, $4, 'Test funds', $5)", [
      id,
      vendorId,
      amountMinor,
      Number(balance_minor) + amountMinor,
      `test-funds:${Date.now()}:${Math.random()}`,
    ]);
  } finally {
    await pool.end();
  }
}

export async function seedStock(input: { vendorId: string; productId: string; warehouseId: string; quantity: number; locationId?: string }): Promise<string> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE vendor_id = $1 ORDER BY created_at LIMIT 1", [input.vendorId]);
    const reference = `IN-GB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const inbound = await pool.query<{ id: string }>(
      `INSERT INTO inbound_shipments (reference, vendor_id, warehouse_id, country_code, status, shipping_mode, expected_arrival_date, declared_box_counts, created_by, received_at)
       VALUES ($1, $2, $3, 'GB', 'RECEIVED', 'LOOSE', current_date, '{"SMALL":1}', $4, now()) RETURNING id`,
      [reference, input.vendorId, input.warehouseId, user.rows[0]!.id],
    );
    const lot = await pool.query<{ id: string }>(
      `INSERT INTO stock_lots (code, vendor_id, product_id, warehouse_id, inbound_id, condition, storage_tier, quantity_available, location_id, received_at)
       VALUES ($1, $2, $3, $4, $5, 'SELLABLE', 'SMALL', $6, $7, now()) RETURNING id`,
      [`LOT-${reference}`, input.vendorId, input.productId, input.warehouseId, inbound.rows[0]!.id, input.quantity, input.locationId ?? null],
    );
    return lot.rows[0]!.id;
  } finally {
    await pool.end();
  }
}

export function invitationToken(test: TestApp, email: string): string {
  return decodeURIComponent(/#token=([^\s]+)/.exec(test.email.lastTo(email)!.text)![1]!);
}

export async function acceptStaffInvitation(test: TestApp, email: string, password = "a partner's own password"): Promise<string> {
  const accepted = await test
    .http()
    .post("/v1/staff-invitations/accept")
    .send({ token: invitationToken(test, email), password })
    .expect(200);
  return enrolMfa(test, email, accepted.body.accessToken as string);
}
