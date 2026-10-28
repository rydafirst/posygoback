import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import type { DirectoryPage } from "../src/shared";
import { codeFrom, createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, startApp, type TestApp } from "./harness";

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = "a long enough password";

interface VendorRow {
  id: string;
  businessName: string;
  ownerEmail: string | null;
  countryCode: string;
  stage: string;
  verificationStatus: string;
  productCount: number;
  unitsInStorage: number;
  walletBalanceMinor: number;
  currency: string;
}

interface ProductRow {
  id: string;
  code: string;
  businessName: string;
  addedByEmail: string | null;
  unitsInStorage: number;
  unitsOnTheWay: number;
  stockState: string;
}

describe("admin vendor and product directory", () => {
  let test: TestApp;
  let superAdmin: string;
  let countryOps: string;
  let liveOwner: string;
  const vendors: Record<string, string> = {};
  const products: Record<string, string> = {};

  async function signUp(email: string, businessName: string, countryCode = "GB", verify = true): Promise<{ vendorId: string; token: string }> {
    await flushRateLimits();
    await test.http().post("/v1/auth/signup").send({ email, password: PASSWORD, businessName, countryCode, acceptTerms: true }).expect(202);
    const [user] = await query<{ vendor_id: string }>("SELECT vendor_id FROM users WHERE email = $1", [email]);
    if (!verify) {
      return { vendorId: user!.vendor_id, token: "" };
    }
    const code = codeFrom(test.email.lastTo(email)!.text);
    const verified = await test.http().post("/v1/auth/verify-email").send({ email, code, password: PASSWORD }).expect(200);
    return { vendorId: user!.vendor_id, token: verified.body.accessToken as string };
  }

  async function setVerification(vendorId: string, status: string, countryCode = "GB"): Promise<void> {
    await query("INSERT INTO vendor_verifications (vendor_id, country_code, status, submitted_at) VALUES ($1, $2, $3, now())", [vendorId, countryCode, status]);
  }

  async function addProduct(token: string, code: string): Promise<string> {
    const created = await test
      .http()
      .post("/v1/vendor/products")
      .set(as(token))
      .send({ code, name: `Wig ${code}`, countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL" })
      .expect(201);
    return created.body.id as string;
  }

  async function list<Row>(path: string, token: string): Promise<DirectoryPage<Row>> {
    return (await test.http().get(path).set(as(token)).expect(200)).body as DirectoryPage<Row>;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("US", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    countryOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");

    vendors.signedUp = (await signUp("new@vendors.example", "Unverified Beauty", "GB", false)).vendorId;
    vendors.verifying = (await signUp("checking@vendors.example", "Checking Hair")).vendorId;
    await setVerification(vendors.verifying, "SUBMITTED");
    vendors.verified = (await signUp("approved@vendors.example", "Approved Wigs")).vendorId;
    await setVerification(vendors.verified, "APPROVED");
    vendors.suspended = (await signUp("paused@vendors.example", "Paused Goods")).vendorId;
    await query("UPDATE vendors SET status = 'SUSPENDED' WHERE id = $1", [vendors.suspended]);

    const us = await signUp("owner@us-vendor.example", "Brooklyn Braids", "US");
    vendors.us = us.vendorId;
    await setVerification(vendors.us, "APPROVED", "US");
    await makeVendorTrade(vendors.us, "US");
    products.us = await addProduct(us.token, "US-1");

    const live = await signUp("owner@lagos-lace.example", "Lagos Lace");
    vendors.live = live.vendorId;
    liveOwner = live.token;
    await setVerification(vendors.live, "APPROVED");
    await makeVendorTrade(vendors.live);
    await fundWallet(vendors.live, 12_500);

    products.stored = await addProduct(liveOwner, "STORED-1");
    products.travelling = await addProduct(liveOwner, "TRAVEL-1");
    products.soldOut = await addProduct(liveOwner, "SOLD-1");
    products.notSent = await addProduct(liveOwner, "NEW-1");

    const [warehouse] = await query<{ id: string }>(
      `INSERT INTO warehouses (country_code, code, name, address_lines, city, postal_code) VALUES ('GB', 'MAN-1', 'Manchester', '["Unit 4"]', 'Manchester', 'M17 1AA') RETURNING id`,
    );
    await seedStock({ vendorId: vendors.live, productId: products.stored, warehouseId: warehouse!.id, quantity: 5 });
    await seedStock({ vendorId: vendors.live, productId: products.soldOut, warehouseId: warehouse!.id, quantity: 0 });
    const [owner] = await query<{ id: string }>("SELECT id FROM users WHERE email = 'owner@lagos-lace.example'");
    const [inbound] = await query<{ id: string }>(
      `INSERT INTO inbound_shipments (reference, vendor_id, warehouse_id, country_code, status, shipping_mode, expected_arrival_date, declared_box_counts, created_by, submitted_at)
       VALUES ('IN-GB-ONWAY1', $1, $2, 'GB', 'SUBMITTED', 'LOOSE', current_date, '{"SMALL":1}', $3, now()) RETURNING id`,
      [vendors.live, warehouse!.id, owner!.id],
    );
    await query("INSERT INTO inbound_lines (inbound_id, product_id, declared_quantity) VALUES ($1, $2, 7)", [inbound!.id, products.travelling]);
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("refuses vendors the same way as every other admin page", async () => {
    await test.http().get("/v1/admin/vendors").set(as(liveOwner)).expect(404);
    await test.http().get(`/v1/admin/vendors/${vendors.live}`).set(as(liveOwner)).expect(404);
    await test.http().get("/v1/admin/products").set(as(liveOwner)).expect(404);
  });

  it("lists every vendor who signed up, including those who never verified their email", async () => {
    const page = await list<VendorRow>("/v1/admin/vendors", superAdmin);
    expect(page.total).toBe(6);
    expect(page.page).toBe(1);
    const unverified = page.items.find((row) => row.id === vendors.signedUp);
    expect(unverified).toMatchObject({ businessName: "Unverified Beauty", ownerEmail: "new@vendors.example", stage: "SIGNED_UP", verificationStatus: "NOT_STARTED", productCount: 0 });
  });

  it("works out each vendor's stage", async () => {
    const stages = Object.fromEntries((await list<VendorRow>("/v1/admin/vendors", superAdmin)).items.map((row) => [row.id, row.stage]));
    expect(stages).toEqual({
      [vendors.signedUp!]: "SIGNED_UP",
      [vendors.verifying!]: "VERIFYING",
      [vendors.verified!]: "VERIFIED",
      [vendors.suspended!]: "SUSPENDED",
      [vendors.us!]: "LIVE",
      [vendors.live!]: "LIVE",
    });
    for (const [stage, vendorId] of [
      ["SIGNED_UP", vendors.signedUp],
      ["VERIFYING", vendors.verifying],
      ["VERIFIED", vendors.verified],
      ["LIVE", vendors.live],
      ["SUSPENDED", vendors.suspended],
    ] as const) {
      const filtered = await list<VendorRow>(`/v1/admin/vendors?stage=${stage}&country=GB`, superAdmin);
      expect(filtered.items.map((row) => row.id)).toEqual([vendorId]);
    }
    await test.http().get("/v1/admin/vendors?stage=HAPPY").set(as(superAdmin)).expect(400);
  });

  it("shows a live vendor's products, stock and wallet", async () => {
    const [row] = (await list<VendorRow>("/v1/admin/vendors?q=lagos", superAdmin)).items;
    expect(row).toMatchObject({ id: vendors.live, ownerEmail: "owner@lagos-lace.example", countryCode: "GB", productCount: 4, unitsInStorage: 5, walletBalanceMinor: 12_500, currency: "GBP" });
    expect((await list<VendorRow>("/v1/admin/vendors?q=CHECKING@VENDORS", superAdmin)).items.map((vendor) => vendor.id)).toEqual([vendors.verifying]);

    const detail = (await test.http().get(`/v1/admin/vendors/${vendors.live}`).set(as(superAdmin)).expect(200)).body;
    expect(detail).toMatchObject({
      businessName: "Lagos Lace",
      stage: "LIVE",
      verification: { status: "APPROVED", submittedAt: expect.any(String), decidedAt: null },
      wallet: { balanceMinor: 12_500, currency: "GBP" },
      counts: { products: 4, inboundShipments: 3, orders: 0 },
      unitsInStorage: 5,
    });
    expect(detail.members).toEqual([expect.objectContaining({ email: "owner@lagos-lace.example", role: "VENDOR_OWNER", emailVerified: true })]);
    expect((detail.products as ProductRow[]).map((product) => product.code).sort()).toEqual(["NEW-1", "SOLD-1", "STORED-1", "TRAVEL-1"]);
  });

  it("lists products across vendors with who added them and their stock state", async () => {
    const page = await list<ProductRow>("/v1/admin/products", superAdmin);
    expect(page.total).toBe(5);
    const byId = Object.fromEntries(page.items.map((row) => [row.id, row]));
    expect(byId[products.stored!]).toMatchObject({ businessName: "Lagos Lace", addedByEmail: "owner@lagos-lace.example", unitsInStorage: 5, unitsOnTheWay: 0, stockState: "IN_STORAGE" });
    expect(byId[products.travelling!]).toMatchObject({ unitsInStorage: 0, unitsOnTheWay: 7, stockState: "ON_THE_WAY" });
    expect(byId[products.soldOut!]).toMatchObject({ unitsInStorage: 0, stockState: "SOLD_OUT" });
    expect(byId[products.notSent!]).toMatchObject({ unitsInStorage: 0, unitsOnTheWay: 0, stockState: "NOT_SENT" });

    for (const [state, productId] of [
      ["IN_STORAGE", products.stored],
      ["ON_THE_WAY", products.travelling],
      ["SOLD_OUT", products.soldOut],
      ["NOT_SENT", products.notSent],
    ] as const) {
      expect((await list<ProductRow>(`/v1/admin/products?stock=${state}&vendorId=${vendors.live}`, superAdmin)).items.map((row) => row.id)).toEqual([productId]);
    }
    expect((await list<ProductRow>(`/v1/admin/products?vendorId=${vendors.verified}`, superAdmin)).total).toBe(0);
    expect((await list<ProductRow>("/v1/admin/products?q=travel", superAdmin)).items.map((row) => row.id)).toEqual([products.travelling]);
  });

  it("keeps country staff to their own country", async () => {
    const page = await list<VendorRow>("/v1/admin/vendors", countryOps);
    expect(page.total).toBe(5);
    expect(page.items.every((row) => row.countryCode === "GB")).toBe(true);
    expect((await list<VendorRow>("/v1/admin/vendors?country=US", countryOps)).items.map((row) => row.id)).not.toContain(vendors.us);
    expect((await list<VendorRow>("/v1/admin/vendors?country=US", superAdmin)).items.map((row) => row.id)).toEqual([vendors.us]);
    await test.http().get(`/v1/admin/vendors/${vendors.us}`).set(as(countryOps)).expect(404);
    await test.http().get(`/v1/admin/vendors/${vendors.live}`).set(as(countryOps)).expect(200);

    const scopedProducts = await list<ProductRow>("/v1/admin/products", countryOps);
    expect(scopedProducts.total).toBe(4);
    expect(scopedProducts.items.map((row) => row.id)).not.toContain(products.us);
    expect((await list<ProductRow>(`/v1/admin/products?vendorId=${vendors.us}`, countryOps)).total).toBe(0);
  });
});
