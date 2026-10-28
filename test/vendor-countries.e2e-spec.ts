import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import type { ImportResultView, InboundSummaryView, LotView, OrderSummaryView, VendorCountryFiguresView, VendorCountryView, WalletView } from "../src/shared";
import { codeFrom, createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, refreshCookie, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp } from "./harness";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = "a long enough password";
const GB_RECIPIENT = { name: "Ada Obi", line1: "1 High Street", city: "Manchester", postalCode: "M1 1AA" };
const US_RECIPIENT = { name: "Sam Lee", line1: "5 Main St", city: "New York", region: "NY", postalCode: "10001" };

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

describe("sellers with stock in several countries", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let productId: string;

  const inCountry = (path: string, country?: string) => (country ? `${path}${path.includes("?") ? "&" : "?"}country=${country}` : path);
  const get = (path: string, country?: string, token = owner) => test.http().get(inCountry(path, country)).set(as(token));
  const post = (path: string, body: object, country?: string, token = owner) => test.http().post(inCountry(path, country)).set(as(token)).send(body);

  async function signUp(email: string, countryCodes: string[]): Promise<string> {
    await test.http().post("/v1/auth/signup").send({ email, password: PASSWORD, businessName: "World Wigs", countryCodes, acceptTerms: true }).expect(202);
    const verified = await test
      .http()
      .post("/v1/auth/verify-email")
      .send({ email, code: codeFrom(test.email.lastTo(email)!.text), password: PASSWORD })
      .expect(200);
    refreshCookie(verified.headers["set-cookie"]);
    return verified.body.accessToken as string;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await query("INSERT INTO countries (code, name, currency, status, config) SELECT 'FR', 'France', 'EUR', 'PROSPECTIVE', config FROM countries WHERE code = 'GB'");
    test = await startApp();
    owner = await signUp("owner@world.example", ["GB", "US"]);
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner))).body.vendorId;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("signing up and adding countries", () => {
    it("opens every country picked at sign-up, with the first as home and a wallet in each currency", async () => {
      const countries = (await get("/v1/vendor/countries").expect(200)).body as VendorCountryView[];
      expect(countries.map(({ code, currency, home }) => ({ code, currency, home }))).toEqual([
        { code: "GB", currency: "GBP", home: true },
        { code: "US", currency: "USD", home: false },
      ]);
      const [vendor] = await query<{ country_code: string }>("SELECT country_code FROM vendors WHERE id = $1", [vendorId]);
      expect(vendor!.country_code).toBe("GB");
      const wallets = await query<{ currency: string }>("SELECT currency FROM wallets WHERE vendor_id = $1 ORDER BY currency", [vendorId]);
      expect(wallets.map((wallet) => wallet.currency)).toEqual(["GBP", "USD"]);
      const gb = (await get("/v1/vendor/wallet", "GB").expect(200)).body as WalletView;
      const us = (await get("/v1/vendor/wallet", "US").expect(200)).body as WalletView;
      expect([gb.currency, gb.countryCode, us.currency, us.countryCode]).toEqual(["GBP", "GB", "USD", "US"]);
      expect(gb.id).not.toBe(us.id);
      expect(((await get("/v1/vendor/wallet").expect(200)).body as WalletView).currency).toBe("GBP");
    });

    it("refuses a country that isn't open, and a request for a country the seller hasn't added", async () => {
      const closed = await test
        .http()
        .post("/v1/auth/signup")
        .send({ email: "closed@world.example", password: PASSWORD, businessName: "Closed", countryCodes: ["GB", "FR"], acceptTerms: true })
        .expect(400);
      expect(closed.body.code).toBe("country_unavailable");
      await test
        .http()
        .post("/v1/auth/signup")
        .send({ email: "twice@world.example", password: PASSWORD, businessName: "Twice", countryCodes: ["GB", "GB"], acceptTerms: true })
        .expect(400);
      const unknown = await get("/v1/vendor/wallet", "FR").expect(400);
      expect(unknown.body.fieldErrors.country).toEqual(["You don't store stock in this country"]);
      await get("/v1/vendor/inventory/lots", "gb").expect(400);
    });

    it("adds a country straight away with its own wallet", async () => {
      const single = (await signUpAndVerify(test, "single@world.example")).accessToken;
      const singleVendor = (await test.http().get("/v1/auth/me").set(as(single))).body.vendorId as string;
      await get("/v1/vendor/wallet", "US", single).expect(400);
      const added = await post("/v1/vendor/countries", { countryCode: "US" }, undefined, single).expect(201);
      expect((added.body as VendorCountryView[]).map((country) => country.code)).toEqual(["GB", "US"]);
      expect(((await get("/v1/vendor/wallet", "US", single).expect(200)).body as WalletView).currency).toBe("USD");
      const wallets = await query<{ currency: string }>("SELECT currency FROM wallets WHERE vendor_id = $1 ORDER BY currency", [singleVendor]);
      expect(wallets.map((wallet) => wallet.currency)).toEqual(["GBP", "USD"]);
      const again = await post("/v1/vendor/countries", { countryCode: "US" }, undefined, single).expect(400);
      expect(again.body.fieldErrors.countryCode).toEqual(["You already store stock here"]);
      expect((await post("/v1/vendor/countries", { countryCode: "FR" }, undefined, single).expect(400)).body.code).toBe("country_unavailable");
      const [audit] = await query<{ action: string }>("SELECT action FROM audit_log_entries WHERE action = 'vendor.country_added' AND vendor_id = $1", [singleVendor]);
      expect(audit).toBeDefined();
    });
  });

  describe("keeping each country apart", () => {
    let gbWarehouse: string;
    let usWarehouse: string;

    beforeAll(async () => {
      await makeVendorTrade(vendorId);
      const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
      const warehouse = (countryCode: string, code: string, city: string, postalCode: string) =>
        test
          .http()
          .post("/v1/warehouse/warehouses")
          .set(as(superAdmin))
          .send({ countryCode, code, name: city, addressLines: ["Unit 1"], city, postalCode })
          .expect(201);
      gbWarehouse = (await warehouse("GB", "MAN-1", "Manchester", "M17 1AA")).body.id;
      usWarehouse = (await warehouse("US", "NWK-1", "Newark", "07102")).body.id;
      productId = (
        await post("/v1/vendor/products", { code: "wig-1", name: "Body wave wig", countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL", barcodes: [] }).expect(201)
      ).body.id;
      await seedStock({ vendorId, productId, warehouseId: gbWarehouse, quantity: 5 });
      await seedStock({ vendorId, productId, warehouseId: usWarehouse, quantity: 7 });
      await fundWallet(vendorId, 5_000, "GBP");
      await fundWallet(vendorId, 8_000, "USD");
    });

    it("shows each country's stock on its own", async () => {
      const gb = (await get("/v1/vendor/inventory/lots", "GB").expect(200)).body as LotView[];
      const us = (await get("/v1/vendor/inventory/lots", "US").expect(200)).body as LotView[];
      expect(gb.map((lot) => [lot.warehouseId, lot.quantityAvailable])).toEqual([[gbWarehouse, 5]]);
      expect(us.map((lot) => [lot.warehouseId, lot.quantityAvailable])).toEqual([[usWarehouse, 7]]);
    });

    it("sends a stock shipment to the selected country only", async () => {
      const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const created = await post("/v1/vendor/inbound", { shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 1 }, lines: [{ productId, quantity: 4 }] }, "US").expect(201);
      expect(created.body).toMatchObject({ countryCode: "US", reference: expect.stringMatching(/^IN-US-/) });
      const us = (await get("/v1/vendor/inbound", "US").expect(200)).body as InboundSummaryView[];
      const gb = (await get("/v1/vendor/inbound", "GB").expect(200)).body as InboundSummaryView[];
      expect(us.map((entry) => entry.id)).toContain(created.body.id);
      expect(gb.map((entry) => entry.id)).not.toContain(created.body.id);
    });

    it("fulfils each order in its own country and charges that country's wallet", async () => {
      const gbOrder = await post("/v1/vendor/orders", { deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 1 }] }] }).expect(201);
      const usOrder = await post("/v1/vendor/orders", { deliveries: [{ recipient: US_RECIPIENT, lines: [{ productId, quantity: 2 }] }] }, "US").expect(201);
      expect(gbOrder.body[0]).toMatchObject({ countryCode: "GB", warehouseName: "Manchester" });
      expect(usOrder.body[0]).toMatchObject({ countryCode: "US", warehouseName: "Newark", reference: expect.stringMatching(/^ORD-US-/) });
      const gbList = (await get("/v1/vendor/orders", "GB").expect(200)).body as OrderSummaryView[];
      const usList = (await get("/v1/vendor/orders", "US").expect(200)).body as OrderSummaryView[];
      expect(gbList.map((order) => order.id)).toEqual([gbOrder.body[0].id]);
      expect(usList.map((order) => order.id)).toEqual([usOrder.body[0].id]);
      expect(((await get("/v1/vendor/wallet", "GB").expect(200)).body as WalletView).balanceMinor).toBe(5_000 - 299);
      expect(((await get("/v1/vendor/wallet", "US").expect(200)).body as WalletView).balanceMinor).toBe(8_000 - 398);
      const [stored] = await query<{ origin_country_code: string; destination_country_code: string; customs_required: boolean; currency: string }>(
        "SELECT origin_country_code, destination_country_code, customs_required, currency FROM orders WHERE id = $1",
        [usOrder.body[0].id],
      );
      expect(stored).toEqual({ origin_country_code: "US", destination_country_code: "US", customs_required: false, currency: "USD" });
    });

    it("rejects an address outside the order's country", async () => {
      const abroad = await post("/v1/vendor/orders", { deliveries: [{ recipient: { ...GB_RECIPIENT, countryCode: "GB" }, lines: [{ productId, quantity: 1 }] }] }, "US").expect(400);
      expect(abroad.body.fieldErrors["deliveries.0.recipient.countryCode"]).toEqual(["Use an address in United States"]);
    });

    it("uses the existing stock check when the country has too little", async () => {
      const short = await post("/v1/vendor/orders", { deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 6 }] }] }, "GB").expect(409);
      expect(short.body.code).toBe("insufficient_stock");
    });

    it("imports a spreadsheet into the selected country", async () => {
      const header = "order_reference,recipient_name,company,phone,email,address_line1,address_line2,city,region,postal_code,country,product_code,quantity";
      const csv = [header, "US-CSV-1,Sam Lee,,,,5 Main St,,New York,NY,10001,,wig-1,1", "US-CSV-2,Ada Obi,,,,1 High Street,,Manchester,,M1 1AA,GB,wig-1,1"].join("\n");
      const result = (await post("/v1/vendor/orders/imports", { filename: "us.csv", csv }, "US").expect(201)).body as ImportResultView;
      const byReference = Object.fromEntries(result.results.map((item) => [item.reference, item]));
      expect(byReference["US-CSV-1"]!.orderReference).toMatch(/^ORD-US-/);
      expect(byReference["US-CSV-2"]!.message).toMatch(/Use an address in United States/);
      expect(((await get("/v1/vendor/orders/imports", "US").expect(200)).body as ImportResultView[]).map((entry) => entry.id)).toEqual([result.id]);
      expect((await get("/v1/vendor/orders/imports", "GB").expect(200)).body).toEqual([]);
    });

    it("takes the country from the integration API", async () => {
      const key = (await post("/v1/vendor/integrations/keys", { name: "Shop" }).expect(201)).body.key as string;
      const missing = await test
        .http()
        .post("/v1/integration/orders")
        .set("X-Api-Key", key)
        .send({ externalReference: "API-1", recipient: US_RECIPIENT, lines: [{ productCode: "wig-1", quantity: 1 }] })
        .expect(400);
      expect(missing.body.fieldErrors.country).toBeDefined();
      const placed = await test
        .http()
        .post("/v1/integration/orders")
        .set("X-Api-Key", key)
        .send({ country: "US", externalReference: "API-1", recipient: US_RECIPIENT, lines: [{ productCode: "wig-1", quantity: 1 }] })
        .expect(201);
      expect(placed.body.reference).toMatch(/^ORD-US-/);
      const notAdded = await test
        .http()
        .post("/v1/integration/orders")
        .set("X-Api-Key", key)
        .send({ country: "FR", externalReference: "API-2", recipient: US_RECIPIENT, lines: [{ productCode: "wig-1", quantity: 1 }] })
        .expect(400);
      expect(notAdded.body.fieldErrors.country).toEqual(["You don't store stock in this country"]);
    });

    it("shows each country's figures in its own currency", async () => {
      const figures = (await get("/v1/vendor/countries/figures").expect(200)).body as VendorCountryFiguresView[];
      expect(figures).toEqual([
        { code: "GB", currency: "GBP", balanceMinor: 5_000 - 299, unitsInStorage: 4, ordersToday: 1 },
        { code: "US", currency: "USD", balanceMinor: 8_000 - 398 - 299 - 299, unitsInStorage: 3, ordersToday: 3 },
      ]);
    });

    it("exports only the selected country", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const exported = await get(`/v1/vendor/exports/orders.csv?from=${today}&to=${today}`, "US").expect(200);
      expect(exported.headers["content-disposition"]).toContain("orders-us-");
      expect(exported.text).toContain("ORD-US-");
      expect(exported.text).not.toContain("ORD-GB-");
    });
  });

  describe("cross-border shipping is gone", () => {
    it("has no lanes, destinations or destination preferences", async () => {
      const [tables] = await query<{ lanes: string | null; destinations: string | null }>(
        "SELECT to_regclass('shipping_lanes')::text AS lanes, to_regclass('vendor_destinations')::text AS destinations",
      );
      expect(tables).toEqual({ lanes: null, destinations: null });
      await get("/v1/countries/GB/destinations").expect(404);
      await test
        .http()
        .put("/v1/vendor/markets")
        .set(as(owner))
        .send({ countryCodes: ["US"] })
        .expect(404);
    });
  });
});
