import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import { StorefrontFulfilmentService } from "../src/modules/commerce/orders/storefront-fulfilment.service";
import { StorefrontOrdersService } from "../src/modules/commerce/orders/storefront-orders.service";
import { StorefrontPayoutsService } from "../src/modules/commerce/orders/storefront-payouts.service";
import { PaymentEventsService } from "../src/modules/finance/payments/payment-events.service";
import type { CheckoutStartedView, PublicStoreView, QuoteView, StorefrontOrderView, StorefrontSettingsView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";
import { handOff } from "./store-helpers";

const SHIP_TO = { name: "Chioma Eze", line1: "8 Deansgate", city: "Manchester", postalCode: "M3 4LQ", countryCode: "GB" };

describe("vendor storefronts", () => {
  let test: TestApp;
  let owner: string;
  let otherOwner: string;
  let vendorId: string;
  let wigId: string;
  let capId: string;
  let finance: string;
  let countryOps: string;
  let operator: string;
  let presetId: string;
  let firstOrder: CheckoutStartedView;
  let firstOrderId: string;

  const http = () => test.http();
  const balance = async () => Number((await query<{ balance_minor: string }>("SELECT balance_minor FROM wallets WHERE vendor_id = $1", [vendorId]))[0]!.balance_minor);
  const orderRow = async (reference: string) =>
    (
      await query<{ id: string; status: string; payout_status: string; fulfilment_order_id: string | null; payout_release_at: Date }>("SELECT * FROM storefront_orders WHERE reference = $1", [
        reference,
      ])
    )[0]!;
  const checkout = async (quantity: number, email = "chioma@buyer.example") =>
    (
      await http()
        .post("/v1/public/stores/ada-hair/checkout")
        .send({ items: [{ productId: wigId, quantity }], shipTo: SHIP_TO, buyerEmail: email, buyerName: "Chioma Eze", deliverySpeed: "STANDARD" })
        .expect(200)
    ).body as CheckoutStartedView;

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
    owner = (await signUpAndVerify(test, "owner@store.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 20_000);
    otherOwner = (await signUpAndVerify(test, "other@store.example")).accessToken;
    await makeVendorTrade((await http().get("/v1/auth/me").set(as(otherOwner))).body.vendorId);
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    countryOps = await createStaff(test, "ops@gfn.test", "COUNTRY_OPS", "GB");
    const warehouse = await http()
      .post("/v1/warehouse/warehouses")
      .set(as(superAdmin))
      .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
      .expect(201);
    operator = await createStaff(test, "operator@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    presetId = (await http().post("/v1/admin/packaging/GB").set(as(superAdmin)).send({ code: "box-s", label: "Small box", kind: "BOX", lengthMm: 300, widthMm: 200, heightMm: 100 }).expect(201)).body
      .id;
    const product = { countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL" };
    wigId = (
      await http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...product, code: "wig-1", name: "Body wave wig", barcodes: [{ value: "WIG-1", symbology: "CODE128" }] })
        .expect(201)
    ).body.id;
    capId = (
      await http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...product, code: "cap-1", name: "Wig cap", barcodes: [{ value: "CAP-1", symbology: "CODE128" }] })
        .expect(201)
    ).body.id;
    await seedStock({ vendorId, productId: wigId, warehouseId: warehouse.body.id, quantity: 5 });
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("setting up a store", () => {
    it("checks the address, price and bank before going live, then takes the set-up fee once", async () => {
      const empty = (await http().get("/v1/vendor/storefront").set(as(owner)).expect(200)).body as StorefrontSettingsView;
      expect(empty.missing).toHaveLength(3);
      const settings = { slug: "ada-hair", displayName: "Ada Hair", about: "Human hair wigs, sent from Manchester.", tone: "pink", returnsAllowed: true, returnWindowDays: 30 };
      await http()
        .put("/v1/vendor/storefront")
        .set(as(owner))
        .send({ ...settings, slug: "admin" })
        .expect(400);
      await http().put("/v1/vendor/storefront").set(as(owner)).send(settings).expect(200);
      const taken = await http().put("/v1/vendor/storefront").set(as(otherOwner)).send(settings).expect(400);
      expect(taken.body.fieldErrors.slug[0]).toMatch(/taken/);
      await http().put(`/v1/vendor/storefront/listings/${wigId}`).set(as(owner)).send({ listed: true }).expect(400);
      await http().put(`/v1/vendor/storefront/listings/${wigId}`).set(as(owner)).send({ listed: true, retailPriceMinor: 6_000, category: "Wigs" }).expect(200);
      await http().put(`/v1/vendor/storefront/listings/${capId}`).set(as(otherOwner)).send({ listed: true, retailPriceMinor: 900 }).expect(404);
      const early = await http().post("/v1/vendor/storefront/go-live").set(as(owner)).expect(409);
      expect(early.body.message).toMatch(/bank account/);
      expect((await http().get("/v1/public/stores").expect(200)).body).toEqual([]);
      expect((await http().post("/v1/vendor/storefront/payouts/setup").set(as(owner)).expect(200)).body.url).toContain("/storefront?payouts=returned");
      await http().post("/v1/vendor/storefront/payouts/refresh").set(as(owner)).expect(200);
      const before = await balance();
      const live = (await http().post("/v1/vendor/storefront/go-live").set(as(owner)).expect(200)).body as StorefrontSettingsView;
      expect(live).toMatchObject({ status: "LIVE", setupFeePaid: true, missing: [] });
      expect(await balance()).toBe(before - 2_500);
      await http().post("/v1/vendor/storefront/pause").set(as(owner)).expect(200);
      await http().post("/v1/vendor/storefront/go-live").set(as(owner)).expect(200);
      expect(await balance()).toBe(before - 2_500);
    });

    it("shows buyers only listed products from live stores", async () => {
      const store = (await http().get("/v1/public/stores/ada-hair").expect(200)).body as PublicStoreView;
      expect(store).toMatchObject({ displayName: "Ada Hair", currency: "GBP", pricesIncludeTax: true, products: [{ id: wigId, priceMinor: 6_000, inStock: true }] });
      await http().get("/v1/public/stores/nobody-here").expect(404);
      expect((await http().get("/v1/public/stores").expect(200)).body).toEqual([{ slug: "ada-hair", displayName: "Ada Hair", countryCode: "GB", updatedAt: expect.any(String) }]);
      const market = (await http().get("/v1/public/marketplace/GB").expect(200)).body as Array<{ id: string }>;
      expect(market.map((product) => product.id)).toEqual([wigId]);
    });
  });

  describe("buying", () => {
    it("prices delivery and shows VAT already included", async () => {
      const quote = (
        await http()
          .post("/v1/public/stores/ada-hair/quote")
          .send({ items: [{ productId: wigId, quantity: 2 }], shipTo: SHIP_TO })
          .expect(200)
      ).body as QuoteView;
      expect(quote).toMatchObject({ currency: "GBP", goodsMinor: 12_000, taxIncluded: true, taxLabel: "VAT" });
      expect(quote.options[0]).toMatchObject({ speed: "STANDARD", taxMinor: 2_000 });
      expect(quote.options[0]!.totalMinor).toBe(12_000 + quote.options[0]!.priceMinor);
      const short = await http()
        .post("/v1/public/stores/ada-hair/quote")
        .send({ items: [{ productId: wigId, quantity: 9 }], shipTo: SHIP_TO })
        .expect(400);
      expect(short.body.fieldErrors.items[0]).toMatch(/Not enough left/);
      await http()
        .post("/v1/public/stores/ada-hair/quote")
        .send({ items: [{ productId: capId, quantity: 1 }], shipTo: SHIP_TO })
        .expect(400);
      await http()
        .post("/v1/public/stores/ada-hair/quote")
        .send({ items: [{ productId: wigId, quantity: 1 }], shipTo: { ...SHIP_TO, postalCode: "NOT A CODE" } })
        .expect(400);
    });

    it("sends a paid order to the warehouse and charges the vendor only the fulfilment fee", async () => {
      firstOrder = await checkout(2);
      expect(firstOrder.redirectUrl).toContain("/checkout/sandbox?order=");
      const pending = await orderRow(firstOrder.reference);
      firstOrderId = pending.id;
      expect(pending.status).toBe("PENDING_PAYMENT");
      const before = await balance();
      const paid = (await http().post(`/v1/public/storefront-orders/${firstOrder.reference}/sandbox-payment`).expect(200)).body as StorefrontOrderView;
      expect(paid).toMatchObject({ status: "FULFILLING", vendorShareMinor: null, platformShareMinor: null });
      const row = await orderRow(firstOrder.reference);
      expect(row).toMatchObject({ payout_status: "HELD" });
      expect(row.payout_release_at).toBeNull();
      const [fulfilment] = await query<{ source: string; external_reference: string }>("SELECT source::text, external_reference FROM orders WHERE id = $1", [row.fulfilment_order_id]);
      expect(fulfilment).toEqual({ source: "STOREFRONT", external_reference: firstOrder.reference });
      expect(await balance()).toBe(before - 398);
      await http().post(`/v1/public/storefront-orders/${firstOrder.reference}/sandbox-payment`).expect(200);
      expect(await query("SELECT id FROM orders WHERE source = 'STOREFRONT'")).toHaveLength(1);
      expect(test.email.lastTo("chioma@buyer.example")!.subject).toBe(`Ada Hair: order ${firstOrder.reference} confirmed`);
      expect(test.email.lastTo("owner@store.example")!.subject).toBe(`New store order ${firstOrder.reference}`);
    });

    it("shows the vendor their share but not the buyer's email", async () => {
      const [order] = (await http().get("/v1/vendor/storefront/orders").set(as(owner)).expect(200)).body as StorefrontOrderView[];
      expect(order).toMatchObject({ reference: firstOrder.reference, buyerEmail: null, vendorShareMinor: 12_000, platformShareMinor: null, payoutStatus: "HELD" });
      await http().get(`/v1/vendor/storefront/orders/${order!.id}`).set(as(otherOwner)).expect(404);
      const staff = (await http().get(`/v1/admin/storefront-orders/${order!.id}`).set(as(countryOps)).expect(200)).body as StorefrontOrderView;
      expect(staff).toMatchObject({ buyerEmail: "chioma@buyer.example", platformShareMinor: expect.any(Number) });
    });

    it("refuses a payment that doesn't match the order", async () => {
      const started = await checkout(1, "mismatch@buyer.example");
      const row = await orderRow(started.reference);
      const result = await test.app
        .get(PaymentEventsService)
        .handle("SANDBOX", "GB", {
          kind: "ORDER_PAID",
          orderKind: "STORE",
          eventId: "forged-1",
          orderId: row.id,
          providerReference: `sandbox_${row.id}`,
          paymentId: "forged",
          amountMinor: 1,
          currency: "GBP",
          type: "forged",
          payload: {},
        });
      expect(result).toBe("rejected: amount or currency does not match");
      expect((await orderRow(started.reference)).status).toBe("PENDING_PAYMENT");
      expect(await test.app.get(StorefrontOrdersService).expireUnpaid(new Date(Date.now() + 3_600_000))).toBe(1);
      expect((await orderRow(started.reference)).status).toBe("CANCELLED");
    });

    it("waits for the vendor to top up when the fulfilment fee can't be paid", async () => {
      await query("UPDATE wallets SET balance_minor = 0 WHERE vendor_id = $1", [vendorId]).catch(() => undefined);
      const current = await balance();
      if (current > 0) {
        await query(
          "INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) SELECT id, vendor_id, 'MANUAL_DEBIT', $2, 0, 'Test drain', 'drain' FROM wallets WHERE vendor_id = $1",
          [vendorId, -current],
        );
      }
      const started = await checkout(1, "late@buyer.example");
      await http().post(`/v1/public/storefront-orders/${started.reference}/sandbox-payment`).expect(200);
      expect((await orderRow(started.reference)).status).toBe("AWAITING_VENDOR_FUNDS");
      expect(test.email.lastTo("owner@store.example")!.subject).toBe(`Top up to send store order ${started.reference}`);
      await fundWallet(vendorId, 5_000);
      await test.app.get(StorefrontFulfilmentService).retryWaiting();
      expect((await orderRow(started.reference)).status).toBe("FULFILLING");
    });
  });

  describe("at the warehouse", () => {
    it("buys the label without charging the vendor, because the buyer paid for delivery", async () => {
      const { fulfilment_order_id: orderId } = await orderRow(firstOrder.reference);
      const staff = (path: string) => http().post(`/v1/warehouse/orders/${orderId}/${path}`).set(as(operator));
      for (let unit = 0; unit < 2; unit += 1) {
        await staff("scans").send({ code: "WIG-1" }).expect(200);
      }
      await staff("pack").send({ presetId, weightGrams: 800 }).expect(200);
      const rated = await staff("actions").send({ action: "FETCH_RATES" }).expect(200);
      const before = await balance();
      const labelled = await staff("actions").send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(200);
      expect(labelled.body).toMatchObject({ status: "LABEL_PURCHASED" });
      expect(await balance()).toBe(before);
      expect((labelled.body.events as Array<{ description: string }>).map((event) => event.description)).toContainEqual(expect.stringContaining("paid by the buyer at checkout"));
      const [charge] = await query<{ shipping_charge_minor: string }>("SELECT shipping_charge_minor FROM orders WHERE id = $1", [orderId]);
      expect(Number(charge!.shipping_charge_minor)).toBe(0);
    });
  });

  describe("money after the sale", () => {
    it("pays the vendor once the hold has passed", async () => {
      await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [firstOrderId]);
      expect(await test.app.get(StorefrontPayoutsService).releaseDue()).toBe(0);
      await handOff(test, firstOrderId);
      const shipped = await orderRow(firstOrder.reference);
      expect(shipped.status).toBe("SHIPPED");
      expect(shipped.payout_release_at.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3_600_000);
      await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [firstOrderId]);
      expect(await test.app.get(StorefrontPayoutsService).releaseDue()).toBe(1);
      expect((await orderRow(firstOrder.reference)).payout_status).toBe("PAID");
      expect(test.email.lastTo("owner@store.example")!.subject).toBe(`£120.00 on its way for store order ${firstOrder.reference}`);
      expect(await test.app.get(StorefrontPayoutsService).releaseDue()).toBe(0);
    });

    it("lets finance refund a buyer, which cancels a held payout", async () => {
      const orders = (await http().get("/v1/admin/storefront-orders").set(as(finance)).expect(200)).body as StorefrontOrderView[];
      const target = orders.find((order) => order.payoutStatus === "HELD")!;
      await http().post(`/v1/admin/storefront-orders/${target.id}/refund`).set(as(countryOps)).send({ amountMinor: target.totalMinor, note: "Buyer changed their mind" }).expect(404);
      const refunded = (await http().post(`/v1/admin/storefront-orders/${target.id}/refund`).set(as(finance)).send({ amountMinor: target.totalMinor, note: "Buyer changed their mind" }).expect(200))
        .body as StorefrontOrderView;
      expect(refunded).toMatchObject({ status: "REFUNDED", payoutStatus: "CANCELLED" });
      expect(test.email.lastTo(target.buyerEmail!)!.subject).toMatch(/refund for order/);
      await http().post(`/v1/admin/storefront-orders/${target.id}/refund`).set(as(finance)).send({ amountMinor: 100, note: "Again please" }).expect(409);
    });
  });
});
