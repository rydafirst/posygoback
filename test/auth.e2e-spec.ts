import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { codeFrom, flushRateLimits, refreshCookie, resetDatabase, signUpAndVerify, startApp, type TestApp, WEB_ORIGIN } from "./harness";
import { query } from "./partner-helpers";

describe("authentication", () => {
  let test: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("signs a vendor up, verifies the email and issues a hardened refresh cookie", async () => {
    await test
      .http()
      .post("/v1/auth/signup")
      .send({ email: "Ada@Example.com", password: "a long enough password", businessName: "Ada Ltd", countryCodes: ["GB"], acceptTerms: true })
      .expect(202, { status: "VERIFICATION_SENT" });

    const code = codeFrom(test.email.lastTo("ada@example.com")!.text);
    const verified = await test.http().post("/v1/auth/verify-email").send({ email: "ada@example.com", code, password: "a long enough password" }).expect(200);

    expect(verified.body.user).toMatchObject({ role: "VENDOR_OWNER", countryCode: "GB", currency: "GBP", mfaState: "NOT_REQUIRED" });
    const cookie = ([] as string[]).concat(verified.headers["set-cookie"] ?? []).find((value) => value.startsWith("gfn_rt="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/v1\/auth/);

    const me = await test.http().get("/v1/auth/me").set("Authorization", `Bearer ${verified.body.accessToken}`).expect(200);
    expect(me.body.email).toBe("ada@example.com");
  });

  it("does not reveal whether an email is already registered", async () => {
    await signUpAndVerify(test, "taken@example.com");
    const again = await test
      .http()
      .post("/v1/auth/signup")
      .send({ email: "taken@example.com", password: "another long password", businessName: "Copycat", countryCodes: ["GB"], acceptTerms: true })
      .expect(202);
    expect(again.body).toEqual({ status: "VERIFICATION_SENT" });
    expect(test.email.lastTo("taken@example.com")!.subject).toMatch(/tried to create an account/);
  });

  it("refuses signup into a country that is not live", async () => {
    const response = await test
      .http()
      .post("/v1/auth/signup")
      .send({ email: "de@example.com", password: "a long enough password", businessName: "DE GmbH", countryCodes: ["DE"], acceptTerms: true })
      .expect(400);
    expect(response.body.code).toBe("country_unavailable");
  });

  it("burns a verification code after five wrong guesses", async () => {
    await test
      .http()
      .post("/v1/auth/signup")
      .send({ email: "guess@example.com", password: "a long enough password", businessName: "Guess", countryCodes: ["GB"], acceptTerms: true })
      .expect(202);
    const realCode = codeFrom(test.email.lastTo("guess@example.com")!.text);
    const wrong = realCode === "00000000" ? "11111111" : "00000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await test.http().post("/v1/auth/verify-email").send({ email: "guess@example.com", code: wrong, password: "a long enough password" }).expect(400);
    }
    const response = await test.http().post("/v1/auth/verify-email").send({ email: "guess@example.com", code: realCode, password: "a long enough password" }).expect(400);
    expect(response.body.code).toBe("invalid_code");
  });

  it("locks an account after repeated wrong passwords without revealing the lock", async () => {
    await signUpAndVerify(test, "lock@example.com", "the right password!");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await test.http().post("/v1/auth/login").send({ email: "lock@example.com", password: "wrong password" }).expect(401);
      expect(response.body.code).toBe("invalid_credentials");
    }
    await flushRateLimits();
    const locked = await test.http().post("/v1/auth/login").send({ email: "lock@example.com", password: "the right password!" }).expect(401);
    expect(locked.body.code).toBe("invalid_credentials");
    expect(test.email.lastTo("lock@example.com")!.subject).toMatch(/paused sign-ins/);
  });

  it("rotates refresh tokens and revokes everything when an old one is replayed", async () => {
    const { accessToken, cookie: first } = await signUpAndVerify(test, "rotate@example.com");
    const second = refreshCookie((await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", first).expect(200)).headers["set-cookie"]);
    await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", second).expect(200);

    const replay = await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", first).expect(401);
    expect(replay.body.code).toBe("session_revoked");
    expect(test.email.lastTo("rotate@example.com")!.subject).toMatch(/signed you out everywhere/);

    const after = await test.http().get("/v1/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(401);
    expect(after.body.code).toBe("session_revoked");
  });

  it("keeps someone signed in for as long as they keep using the app", async () => {
    const { cookie } = await signUpAndVerify(test, "stays@example.com");
    await query("UPDATE sessions SET expires_at = now() + interval '1 hour' WHERE user_id = (SELECT id FROM users WHERE email = 'stays@example.com')");
    const refreshed = await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", cookie).expect(200);
    const [session] = await query<{ expires_at: Date }>("SELECT expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'stays@example.com')");
    expect(session!.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(refreshed.headers["set-cookie"]?.toString()).toMatch(/Max-Age=2592000/);
  });

  it("rejects refresh from another origin", async () => {
    const { cookie } = await signUpAndVerify(test, "origin@example.com");
    const response = await test.http().post("/v1/auth/refresh").set("Origin", "https://evil.example").set("Cookie", cookie).expect(403);
    expect(response.body.code).toBe("origin_rejected");
  });

  it("stops an access token working the moment its session is logged out", async () => {
    const { accessToken, cookie } = await signUpAndVerify(test, "logout@example.com");
    await test.http().get("/v1/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(200);
    await test.http().post("/v1/auth/logout").set("Origin", WEB_ORIGIN).set("Cookie", cookie).expect(204);
    await test.http().get("/v1/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(401);
  });

  it("resets a password, signs out every session and accepts only the new password", async () => {
    const { accessToken } = await signUpAndVerify(test, "reset@example.com", "the original password");
    await test.http().post("/v1/auth/forgot-password").send({ email: "reset@example.com" }).expect(202);
    const link = test.email.lastTo("reset@example.com")!.text;
    const token = decodeURIComponent(/#token=([^\s]+)/.exec(link)![1]!);

    await test.http().post("/v1/auth/reset-password").send({ token, password: "a brand new password" }).expect(204);
    await test.http().post("/v1/auth/reset-password").send({ token, password: "replayed reset attempt" }).expect(400);
    await test.http().get("/v1/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(401);
    await test.http().post("/v1/auth/login").send({ email: "reset@example.com", password: "the original password" }).expect(401);
    await test.http().post("/v1/auth/login").send({ email: "reset@example.com", password: "a brand new password" }).expect(200);
  });

  it("stops someone who pre-registers an email from owning the real person's account", async () => {
    const signup = (password: string, businessName: string) =>
      test
        .http()
        .post("/v1/auth/signup")
        .send({ email: "victim@example.com", password, businessName, countryCodes: ["GB"], acceptTerms: true })
        .expect(202);

    await signup("attacker chosen password", "Evil Ltd");
    await signup("the victims own password", "Victim Ltd");
    const code = codeFrom(test.email.lastTo("victim@example.com")!.text);

    await test.http().post("/v1/auth/verify-email").send({ email: "victim@example.com", code, password: "attacker chosen password" }).expect(400);
    const verified = await test.http().post("/v1/auth/verify-email").send({ email: "victim@example.com", code, password: "the victims own password" }).expect(200);
    expect(verified.body.user.businessName).toBe("Victim Ltd");
    await test.http().post("/v1/auth/login").send({ email: "victim@example.com", password: "attacker chosen password" }).expect(401);
  });

  it("does not let failures from one address lock the owner out from another", async () => {
    await signUpAndVerify(test, "target@example.com", "the owners password!");
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await test
        .http()
        .post("/v1/auth/login")
        .set("x-test-client-ip", `203.0.113.${attempt}`)
        .send({ email: "target@example.com", password: `guess ${attempt}` });
    }
    await flushRateLimits();
    await test.http().post("/v1/auth/login").set("x-test-client-ip", "198.51.100.7").send({ email: "target@example.com", password: "wrong once more" }).expect(401);
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    await pool.query("UPDATE users SET locked_until = NULL WHERE email = $1", ["target@example.com"]);
    await pool.end();
    await test.http().post("/v1/auth/login").set("x-test-client-ip", "198.51.100.7").send({ email: "target@example.com", password: "the owners password!" }).expect(200);
  });

  it("verifies a pending account through a password reset, since the link proves the email", async () => {
    await test
      .http()
      .post("/v1/auth/signup")
      .send({ email: "stuck@example.com", password: "someone elses password", businessName: "Stuck", countryCodes: ["GB"], acceptTerms: true })
      .expect(202);
    await test.http().post("/v1/auth/forgot-password").send({ email: "stuck@example.com" }).expect(202);
    const token = decodeURIComponent(/#token=([^\s]+)/.exec(test.email.lastTo("stuck@example.com")!.text)![1]!);
    await test.http().post("/v1/auth/reset-password").send({ token, password: "my own fresh password" }).expect(204);
    await test.http().post("/v1/auth/login").send({ email: "stuck@example.com", password: "my own fresh password" }).expect(200);
  });

  it("never stores codes, tokens or passwords in plain text", async () => {
    await signUpAndVerify(test, "plain@example.com", "plaintext check password");
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    const { rows } = await pool.query("SELECT u.password_hash, s.refresh_token_hash FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.email = $1", ["plain@example.com"]);
    await pool.end();
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
