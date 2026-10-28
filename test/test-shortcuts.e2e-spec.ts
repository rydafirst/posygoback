import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp, WEB_ORIGIN } from "./harness";
import { as } from "./partner-helpers";

const VENDOR = { email: "owner@shortcut.example", password: "a long enough password" };

async function addStaff(email: string, password: string): Promise<void> {
  const { hash, argon2id } = await import("argon2");
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  await pool.query("INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES ($1, $2, 'ADMIN', 'ACTIVE', now())", [email, await hash(password, { type: argon2id })]);
  await pool.end();
}

describe("sign-in shortcuts for testing without email", () => {
  let off: TestApp;
  let on: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    off = await startApp();
    process.env.AUTH_TEST_SHORTCUTS = "on";
    on = await startApp();
    delete process.env.AUTH_TEST_SHORTCUTS;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await off.app.close();
    await on.app.close();
  });

  it("are off unless switched on, and refused in production", async () => {
    expect((await off.http().get("/v1/auth/test-shortcuts").expect(200)).body).toEqual({ enabled: false });
    await off.http().post("/v1/auth/test-shortcuts/verify-email").set("Origin", WEB_ORIGIN).send(VENDOR).expect(404);
    expect(() => loadConfig({ ...process.env, NODE_ENV: "production", AUTH_TEST_SHORTCUTS: "on" })).toThrow(/shortcuts/);
  });

  it("let a new vendor in without the emailed code, but only with their password", async () => {
    await on
      .http()
      .post("/v1/auth/signup")
      .send({ ...VENDOR, businessName: "Shortcut Ltd", countryCodes: ["GB"], acceptTerms: true })
      .expect(202);
    expect((await on.http().get("/v1/auth/test-shortcuts").expect(200)).body).toEqual({ enabled: true });
    await on
      .http()
      .post("/v1/auth/test-shortcuts/verify-email")
      .set("Origin", WEB_ORIGIN)
      .send({ ...VENDOR, password: "the wrong password!!" })
      .expect(401);
    const signedIn = await on.http().post("/v1/auth/test-shortcuts/verify-email").set("Origin", WEB_ORIGIN).send(VENDOR).expect(200);
    expect(signedIn.body.user.email).toBe(VENDOR.email);
    await on.http().post("/v1/auth/test-shortcuts/verify-email").set("Origin", WEB_ORIGIN).send(VENDOR).expect(401);
  });

  it("let staff past authenticator set-up for this session only", async () => {
    await addStaff("admin@shortcut.example", "staff member password");
    const login = await on.http().post("/v1/auth/login").send({ email: "admin@shortcut.example", password: "staff member password" }).expect(200);
    const pending = login.body.accessToken as string;
    await on.http().get("/v1/admin/dashboard").set(as(pending)).expect(403);
    await off.http().post("/v1/auth/mfa/skip").set(as(pending)).expect(404);
    const skipped = await on.http().post("/v1/auth/mfa/skip").set(as(pending)).expect(200);
    await on.http().get("/v1/admin/dashboard").set(as(skipped.body.accessToken)).expect(200);
    await on.http().post("/v1/auth/mfa/skip").set(as(skipped.body.accessToken)).expect(404);
  });
});
