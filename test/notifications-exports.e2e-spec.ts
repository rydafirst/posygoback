import { WalletAlertsService } from "../src/modules/finance/wallets/wallet-alerts.service";
import type { NotificationFeedView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

describe("notifications and exports", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let otherOwner: string;
  let staff: string;

  const http = () => test.http();
  const feed = async (token: string) => (await http().get("/v1/notifications").set(as(token)).expect(200)).body as NotificationFeedView;

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@exports.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 20_000);
    otherOwner = (await signUpAndVerify(test, "other@exports.example")).accessToken;
    staff = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("notifications", () => {
    it("puts every message we email a vendor into their feed, for them only", async () => {
      await test.app.get(WalletAlertsService).notifyOwner(vendorId, (to) => ({ to, subject: "Return RMA-1 has arrived", text: "We've received 1 item.\n\nPosygo" }), "/returns");
      const mine = await feed(owner);
      expect(mine).toMatchObject({ unread: 1, items: [{ title: "Return RMA-1 has arrived", body: "We've received 1 item.", href: "/returns", read: false }] });
      expect(test.email.lastTo("owner@exports.example")!.subject).toBe("Return RMA-1 has arrived");
      expect((await feed(otherOwner)).items).toHaveLength(0);
      expect((await feed(staff)).items).toHaveLength(0);
      const id = mine.items[0]!.id;
      await http().post(`/v1/notifications/${id}/read`).set(as(otherOwner)).expect(404);
      expect((await http().post(`/v1/notifications/${id}/read`).set(as(owner)).expect(200)).body).toMatchObject({ unread: 0 });
      await http().get("/v1/notifications").expect(401);
    });

    it("marks everything read at once", async () => {
      const alerts = test.app.get(WalletAlertsService);
      for (const subject of ["First", "Second"]) {
        await alerts.notifyOwner(vendorId, (to) => ({ to, subject, text: "Body" }));
      }
      expect((await feed(owner)).unread).toBe(2);
      expect((await http().post("/v1/notifications/read-all").set(as(owner)).expect(200)).body).toMatchObject({ unread: 0 });
    });
  });

  describe("exports", () => {
    const today = new Date().toISOString().slice(0, 10);

    it("downloads orders as CSV with spreadsheet formulas made harmless", async () => {
      const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
      const warehouseId = (
        await http()
          .post("/v1/warehouse/warehouses")
          .set(as(superAdmin))
          .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4"], city: "Manchester", postalCode: "M17 1AA" })
          .expect(201)
      ).body.id;
      const productId = (
        await http()
          .post("/v1/vendor/products")
          .set(as(owner))
          .send({ countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL", code: "wig-1", name: "Body wave wig", barcodes: [{ value: "WIG-1", symbology: "CODE128" }] })
          .expect(201)
      ).body.id;
      await seedStock({ vendorId, productId, warehouseId, quantity: 5 });
      const recipient = { name: "=HYPERLINK(evil)", line1: "1 High Street", city: "Manchester", postalCode: "M1 1AA", countryCode: "GB" };
      const [order] = (
        await http()
          .post("/v1/vendor/orders")
          .set(as(owner))
          .send({ deliveries: [{ recipient, lines: [{ productId, quantity: 2 }] }] })
          .expect(201)
      ).body as Array<{ reference: string }>;
      const csv = await http().get(`/v1/vendor/exports/orders.csv?from=${today}&to=${today}`).set(as(owner)).expect(200);
      expect(csv.headers["content-type"]).toMatch(/text\/csv/);
      expect(csv.headers["content-disposition"]).toBe(`attachment; filename="orders-${today}-to-${today}.csv"`);
      expect(csv.text).toContain(order!.reference);
      expect(csv.text).toContain("'=HYPERLINK(evil)");
      expect(csv.text).not.toMatch(/,=HYPERLINK/);
      const other = await http().get(`/v1/vendor/exports/orders.csv?from=${today}&to=${today}`).set(as(otherOwner)).expect(200);
      expect(other.text).not.toContain(order!.reference);
      const stock = await http().get("/v1/vendor/exports/inventory.csv").set(as(owner)).expect(200);
      expect(stock.text).toMatch(/wig-1,Body wave wig/i);
    });

    it("downloads the wallet ledger, checks the dates, and keeps it from staff and other vendors", async () => {
      const ledger = await http().get(`/v1/vendor/exports/ledger.csv?from=${today}&to=${today}`).set(as(owner)).expect(200);
      expect(ledger.text.split("\r\n")[0]).toBe("﻿created_at,type,description,currency,amount,balance_after,reference_type,reference_id");
      expect(ledger.text).toContain("DEPOSIT");
      await http().get(`/v1/vendor/exports/ledger.csv?from=${today}&to=2020-01-01`).set(as(owner)).expect(400);
      await http().get("/v1/vendor/exports/ledger.csv?from=2024-01-01&to=2026-01-02").set(as(owner)).expect(400);
      await http().get(`/v1/vendor/exports/ledger.csv?from=${today}&to=${today}`).set(as(staff)).expect(404);
    });
  });
});
