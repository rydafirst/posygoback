import type { EmailLogView } from "../src/shared";
import { argon2id, hash } from "argon2";
import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { codeFrom, createStaff, flushRateLimits, resetDatabase, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const EMAIL = "trail@example.test";
const PASSWORD = "a long enough password";

describe("email trail: sign-in and accounts", () => {
  let test: TestApp;
  const kinds = () => test.email.sent.filter((message) => message.to === EMAIL).map((message) => message.kind);
  const signIn = (userAgent: string) => test.http().post("/v1/auth/login").set("User-Agent", userAgent).send({ email: EMAIL, password: PASSWORD });

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("sends a code, then a welcome with a link to the dashboard once the account is confirmed", async () => {
    await test
      .http()
      .post("/v1/auth/signup")
      .set("User-Agent", CHROME_WINDOWS)
      .send({ email: EMAIL, password: PASSWORD, businessName: "Trail Traders", countryCode: "GB", acceptTerms: true })
      .expect(202);
    const code = codeFrom(test.email.lastTo(EMAIL)!.text);
    await test.http().post("/v1/auth/verify-email").set("User-Agent", CHROME_WINDOWS).send({ email: EMAIL, code, password: PASSWORD }).expect(200);
    expect(kinds()).toEqual(["auth.verify_email", "auth.welcome"]);
    const welcome = test.email.lastTo(EMAIL)!;
    expect(welcome.subject).toBe("Welcome to Posygo, Trail Traders");
    expect(welcome.action).toEqual({ label: "Open your dashboard", url: "http://localhost:3000/overview" });
  });

  it("warns about a sign-in from a new browser, but not from one used before", async () => {
    await signIn(CHROME_WINDOWS).expect(200);
    expect(kinds().at(-1)).toBe("auth.welcome");
    await signIn(SAFARI_IPHONE).expect(200);
    const alert = test.email.lastTo(EMAIL)!;
    expect(alert.kind).toBe("auth.new_sign_in");
    expect(alert.text).toContain("Device: Safari on iOS");
    await signIn(SAFARI_IPHONE).expect(200);
    expect(kinds().filter((kind) => kind === "auth.new_sign_in")).toHaveLength(1);
  });

  it("emails at each step of a password reset", async () => {
    await test.http().post("/v1/auth/forgot-password").send({ email: EMAIL }).expect(202);
    const reset = test.email.lastTo(EMAIL)!;
    expect(reset.kind).toBe("auth.password_reset");
    const token = decodeURIComponent(/#token=([^\s]+)/.exec(reset.text)![1]!);
    await test.http().post("/v1/auth/reset-password").send({ token, password: "a brand new long password" }).expect(204);
    expect(kinds().at(-1)).toBe("auth.password_changed");
  });

  it("keeps a log of every email, without the codes, for support to check", async () => {
    const admin = await createStaff(test, "support@gfn.test", "ADMIN");
    const log = (await test.http().get(`/v1/admin/emails?to=${EMAIL}`).set(as(admin)).expect(200)).body as EmailLogView[];
    expect(log.map((entry) => entry.kind).reverse()).toEqual(["auth.verify_email", "auth.welcome", "auth.new_sign_in", "auth.password_reset", "auth.password_changed"]);
    expect(log.every((entry) => entry.status === "SENT")).toBe(true);
    expect(log.find((entry) => entry.kind === "auth.verify_email")!.subject).toBe("•••••• is your verification code");
  });

  it("sends a fresh two-factor set-up code on request, keeping the same app key, and the old code stops working", async () => {
    const staffEmail = "new-staff@gfn.test";
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    await pool.query("INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES ($1, $2, 'ADMIN', 'ACTIVE', now())", [staffEmail, await hash(PASSWORD, { type: argon2id })]);
    await pool.end();
    const login = await test.http().post("/v1/auth/login").send({ email: staffEmail, password: PASSWORD }).expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };
    const start = await test.http().post("/v1/auth/mfa/enrolment").set(auth).expect(200);
    const firstCode = codeFrom(test.email.lastTo(staffEmail)!.text);
    await test.http().post("/v1/auth/mfa/enrolment/resend-code").set(auth).expect(204);
    const secondCode = codeFrom(test.email.lastTo(staffEmail)!.text);
    expect(secondCode).not.toBe(firstCode);
    expect(test.email.sent.filter((message) => message.to === staffEmail).map((message) => message.kind)).toEqual(["auth.mfa_enrolment_code", "auth.mfa_enrolment_code"]);
    const { authenticator } = await import("otplib");
    await test
      .http()
      .post("/v1/auth/mfa/enrolment/confirm")
      .set(auth)
      .send({ code: authenticator.generate(start.body.secret as string), emailCode: firstCode })
      .expect(400);
    await flushRateLimits();
    await test
      .http()
      .post("/v1/auth/mfa/enrolment/confirm")
      .set(auth)
      .send({ code: authenticator.generate(start.body.secret as string), emailCode: secondCode })
      .expect(200);
    await test.http().post("/v1/auth/mfa/enrolment/resend-code").set(auth).expect(409);
  });
});
