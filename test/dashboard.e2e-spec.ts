import type { DashboardView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

describe("console dashboard", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let finance: string;
  let operator: string;
  let usOps: string;

  const http = () => test.http();
  const view = async (token: string, country = "") =>
    (
      await http()
        .get(`/v1/admin/dashboard${country ? `?country=${country}` : ""}`)
        .set(as(token))
        .expect(200)
    ).body as DashboardView;

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@dash.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 12_345);
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    operator = await createStaff(test, "operator@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    usOps = await createStaff(test, "us-ops@gfn.test", "COUNTRY_OPS", "US");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("shows each person only what they can act on, and the money in their markets", async () => {
    const all = await view(finance);
    expect(all.countryCode).toBeNull();
    expect(all.activity).toMatchObject({ newVendors: expect.any(Number), walletBalances: [{ currency: "GBP", amountMinor: 12_345 }] });
    expect(all.attention.every((item) => item.count > 0)).toBe(true);
    const gb = await view(finance, "GB");
    expect(gb.countryCode).toBe("GB");
    expect((await view(finance, "US")).activity!.walletBalances).toEqual([]);
    const warehouse = await view(operator);
    expect(warehouse).toMatchObject({ countryCode: "GB", activity: null });
    expect(warehouse.attention.map((item) => item.permission).every((permission) => ["inbound.receive", "orders.read"].includes(permission))).toBe(true);
    const scoped = await view(usOps, "GB");
    expect(scoped.countryCode).toBe("US");
    await http().get("/v1/admin/dashboard").set(as(owner)).expect(404);
    await http().get("/v1/admin/dashboard?country=gb").set(as(finance)).expect(400);
    await http().get("/v1/admin/dashboard").expect(401);
  });
});
