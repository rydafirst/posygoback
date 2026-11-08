import { MAJOR_COUNTRIES } from "../src/shared/country/major-countries";
import { SEED_FEE_SCHEDULES } from "../src/shared/finance/seed-fee-schedules";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

describe("seller payments in a country without its own payment account", () => {
  let test: TestApp;
  let token: string;
  let vendorId: string;

  const http = () => test.http();

  beforeAll(async () => {
    await resetDatabase();
    const canada = MAJOR_COUNTRIES.find((country) => country.code === "CA")!;
    await query("INSERT INTO countries (code, name, currency, status, config) VALUES ($1, $2, $3, 'LIVE', $4)", [canada.code, canada.name, canada.currency, JSON.stringify(canada.config)]);
    await query("INSERT INTO fee_schedules (country_code, version, status, schedule, note) VALUES ('CA', 1, 'ACTIVE', $1, 'Test prices')", [JSON.stringify(SEED_FEE_SCHEDULES.CA)]);
    await insertLegalDocument("CA", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    await http().put("/v1/admin/activation-fee").set(as(superAdmin)).send({ activationFeeMinor: 1000 }).expect(200);
    token = (await signUpAndVerify(test, "owner@toronto.example", undefined, "CA")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(token)).expect(200)).body.vendorId as string;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("charges the flat US dollar activation fee through the platform account", async () => {
    await query("UPDATE vendors SET activation_due_at = now() WHERE id = $1", [vendorId]);

    expect((await http().get("/v1/vendor/activation").set(as(token)).expect(200)).body).toMatchObject({ state: "DUE", feeMinor: 1000, currency: "USD" });
    const started = await http().post("/v1/vendor/activation/checkout").set(as(token)).expect(201);
    const [payment] = await query<{ country_code: string; account_key: string; currency: string; fee_minor: string }>(
      "SELECT country_code, account_key, currency, fee_minor FROM vendor_activation_payments WHERE id = $1",
      [started.body.paymentId],
    );
    expect(payment).toEqual({ country_code: "CA", account_key: "GB", currency: "USD", fee_minor: "1000" });

    const paid = await http().post(`/v1/vendor/activation/payments/${started.body.paymentId}/sandbox-pay`).set(as(token)).expect(200);
    expect(paid.body.state).toBe("LIVE");
  });

  it("tops up the Canadian wallet in dollars through the platform account", async () => {
    const started = await http().post("/v1/vendor/wallet/top-ups").set(as(token)).send({ amountMinor: 10_000 }).expect(201);
    expect(started.body.currency).toBe("CAD");
    const [topUp] = await query<{ country_code: string; account_key: string; currency: string }>("SELECT country_code, account_key, currency FROM top_ups WHERE id = $1", [started.body.topUpId]);
    expect(topUp).toEqual({ country_code: "CA", account_key: "GB", currency: "CAD" });

    await http().post(`/v1/vendor/wallet/top-ups/${started.body.topUpId}/sandbox-pay`).set(as(token)).expect(200);
    const listed = (await http().get("/v1/vendor/wallet/top-ups").set(as(token)).expect(200)).body as Array<{ id: string; status: string }>;
    expect(listed).toEqual([expect.objectContaining({ id: started.body.topUpId, status: "SUCCEEDED" })]);
    const [wallet] = await query<{ balance_minor: string }>("SELECT balance_minor FROM wallets WHERE vendor_id = $1 AND currency = 'CAD'", [vendorId]);
    expect(wallet!.balance_minor).toBe("10000");
  });
});
