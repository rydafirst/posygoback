import { authenticator } from "otplib";
import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { codeFrom, flushRateLimits, resetDatabase, signUpAndVerify, startApp, SUPER_ADMIN, type TestApp } from "./harness";

const GERMANY = {
  code: "DE",
  name: "Germany",
  currency: "EUR",
  config: {
    locale: "de-DE",
    phoneCountryCode: "+49",
    measurementSystem: "METRIC",
    address: { postalCodeLabel: "PLZ", postalCodePattern: "^\\d{5}$", regionLabel: "Bundesland", regionRequired: false, regionCodes: [] },
    tax: { model: "VAT", standardRateBps: 1900, pricesIncludeTax: true, registrationLabel: "USt-IdNr." },
    kyc: { businessTypes: [{ code: "GMBH", label: "GmbH" }], idTypes: [{ code: "PASSPORT", label: "Reisepass" }], companyNumber: { label: "Handelsregisternummer", required: false } },
    carrierCodes: ["dhl_de"],
    feeScheduleKey: "fee_schedule_de",
  },
};

describe("privileged access", () => {
  let test: TestApp;
  let adminToken: string;
  let recoveryCodes: string[];
  let adminSecret: string;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("blocks a super admin from everything until two-factor is set up", async () => {
    const login = await test.http().post("/v1/auth/login").send(SUPER_ADMIN).expect(200);
    expect(login.body.status).toBe("AUTHENTICATED");
    expect(login.body.user.mfaState).toBe("ENROLMENT_REQUIRED");
    expect(login.body.user.permissions).toEqual([]);

    const blocked = await test.http().get("/v1/admin/countries").set("Authorization", `Bearer ${login.body.accessToken}`).expect(403);
    expect(blocked.body.code).toBe("mfa_enrolment_required");

    const start = await test.http().post("/v1/auth/mfa/enrolment").set("Authorization", `Bearer ${login.body.accessToken}`).expect(200);
    expect(start.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(start.body.emailCodeRequired).toBe(true);

    const withoutEmailCode = await test
      .http()
      .post("/v1/auth/mfa/enrolment/confirm")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ code: authenticator.generate(start.body.secret) })
      .expect(400);
    expect(withoutEmailCode.body.fieldErrors.emailCode).toBeDefined();

    const emailCode = codeFrom(test.email.lastTo(SUPER_ADMIN.email)!.text);
    const confirmed = await test
      .http()
      .post("/v1/auth/mfa/enrolment/confirm")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ code: authenticator.generate(start.body.secret), emailCode })
      .expect(200);
    adminSecret = start.body.secret;
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    expect(confirmed.body.user.mfaState).toBe("VERIFIED");
    adminToken = confirmed.body.accessToken;
    recoveryCodes = confirmed.body.recoveryCodes;

    await test.http().get("/v1/admin/countries").set("Authorization", `Bearer ${adminToken}`).expect(200);
  });

  it("requires the second factor on the next sign-in and accepts each recovery code once", async () => {
    const first = await test.http().post("/v1/auth/login").send(SUPER_ADMIN).expect(200);
    expect(first.body).toEqual({ status: "MFA_REQUIRED", challengeToken: expect.any(String) });

    const [recovery] = recoveryCodes;
    const passed = await test.http().post("/v1/auth/mfa/challenge").send({ challengeToken: first.body.challengeToken, recoveryCode: recovery }).expect(200);
    expect(passed.body.user.mfaState).toBe("VERIFIED");

    await test.http().post("/v1/auth/mfa/challenge").send({ challengeToken: first.body.challengeToken, recoveryCode: recoveryCodes[1] }).expect(401);

    const second = await test.http().post("/v1/auth/login").send(SUPER_ADMIN).expect(200);
    await test.http().post("/v1/auth/mfa/challenge").send({ challengeToken: second.body.challengeToken, recoveryCode: recovery }).expect(401);
  });

  it("counts wrong authenticator codes towards the account lock", async () => {
    const reset = new Pool({ connectionString: loadConfig().DATABASE_URL });
    await reset.query("UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE email = $1", [SUPER_ADMIN.email]);
    await reset.end();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await flushRateLimits();
      const login = await test.http().post("/v1/auth/login").send(SUPER_ADMIN).expect(200);
      const wrong = authenticator.generate(adminSecret) === "000000" ? "111111" : "000000";
      await test.http().post("/v1/auth/mfa/challenge").send({ challengeToken: login.body.challengeToken, code: wrong }).expect(401);
    }
    await flushRateLimits();
    await test.http().post("/v1/auth/login").send(SUPER_ADMIN).expect(401);
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    await pool.query("UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE email = $1", [SUPER_ADMIN.email]);
    await pool.end();
  });

  it("hides admin endpoints from vendors", async () => {
    const vendor = await signUpAndVerify(test, "vendor@example.com");
    await test.http().get("/v1/admin/countries").set("Authorization", `Bearer ${vendor.accessToken}`).expect(404);
  });

  it("adds a country with data alone and enforces its lifecycle", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const created = await test.http().post("/v1/admin/countries").set(auth).send(GERMANY).expect(201);
    expect(created.body.status).toBe("PROSPECTIVE");
    await test.http().post("/v1/admin/countries").set(auth).send(GERMANY).expect(409);

    const skip = await test.http().post("/v1/admin/countries/DE/status").set(auth).send({ status: "LIVE", reason: "skip onboarding" }).expect(409);
    expect(skip.body.code).toBe("invalid_transition");

    await test.http().post("/v1/admin/countries/DE/status").set(auth).send({ status: "ONBOARDING", reason: "partner found" }).expect(201);
    await test.http().post("/v1/admin/countries/DE/status").set(auth).send({ status: "LIVE", reason: "pilot passed" }).expect(201);

    const live = await test.http().get("/v1/countries").expect(200);
    const codes = (live.body as Array<{ code: string }>).map((country) => country.code);
    expect(codes).toContain("DE");
  });

  it("refuses a domestic lane that claims to need customs", async () => {
    const response = await test
      .http()
      .put("/v1/admin/countries/lanes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originCountryCode: "DE", destinationCountryCode: "DE", enabled: true, customsRequired: true })
      .expect(400);
    expect(response.body.fieldErrors.customsRequired).toBeDefined();
  });

  it("shows a vendor only the destinations enabled from its own country", async () => {
    const vendor = await signUpAndVerify(test, "lanes@example.com");
    const auth = { Authorization: `Bearer ${vendor.accessToken}` };
    const destinations = await test.http().get("/v1/countries/GB/destinations").set(auth).expect(200);
    expect(destinations.body).toMatchObject([
      { code: "GB", name: "United Kingdom", customsRequired: false, address: { postalCodeLabel: "Postcode" } },
      { code: "US", name: "United States", customsRequired: true, address: { regionLabel: "State" } },
    ]);
    await test.http().get("/v1/countries/US/destinations").set(auth).expect(404);
  });

  it("keeps an unbroken, tamper-evident audit chain", async () => {
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    const { rows } = await pool.query(`
      WITH ordered AS (
        SELECT e, e.hash, e.prev_hash, lag(e.hash) OVER (ORDER BY e.sequence) AS expected_prev
        FROM audit_log_entries e
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE hash <> audit_entry_digest(e, prev_hash))::int AS bad_hashes,
             count(*) FILTER (WHERE prev_hash <> coalesce(expected_prev, repeat('0', 64)))::int AS broken_links
      FROM ordered`);
    await expect(pool.query("UPDATE audit_log_entries SET action = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM audit_log_entries")).rejects.toThrow(/append-only/);
    await pool.end();
    expect(rows[0].total).toBeGreaterThan(5);
    expect(rows[0].bad_hashes).toBe(0);
    expect(rows[0].broken_links).toBe(0);
  });
});
