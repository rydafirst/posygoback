import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { JobLockService } from "../src/modules/finance/jobs/job-lock.service";
import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import { CarrierError, type CarrierRate, type LabelRate, type PurchasedLabel, type RateRequest, type TrackingSnapshot } from "../src/modules/orders/carriers/carrier.port";
import { ShippoCarrier } from "../src/modules/orders/carriers/shippo.carrier";
import type { CarrierTrackingEvent, ImportResultView, OrderDetailView, OrderSummaryView, ShippingEstimateView } from "../src/shared";
import { CARRIER_WEBHOOK_TOKEN, createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp } from "./harness";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

class FakeShippo extends ShippoCarrier {
  failNextLabel: "refused" | "timeout" | null = null;
  failNextTracking = false;
  voided: string[] = [];
  quotes: RateRequest[] = [];
  trackingEvents: CarrierTrackingEvent[] = [];
  bought: PurchasedLabel[] = [];
  private labels = 0;

  constructor() {
    super("shippo_test_fake");
  }

  override quote(request: RateRequest): Promise<CarrierRate[]> {
    this.quotes.push(request);
    return Promise.resolve([
      { providerRateId: `rate_ground_${request.reference}`, carrier: "UPS", carrierCode: "ups", service: "Ground", costMinor: 640, currency: request.currency, estimatedDays: 3 },
      { providerRateId: `rate_air_${request.reference}`, carrier: "UPS", carrierCode: "ups", service: "Next Day", costMinor: 1999, currency: request.currency, estimatedDays: 1 },
    ]);
  }

  override buyLabel(rate: LabelRate): Promise<PurchasedLabel> {
    const failure = this.failNextLabel;
    this.failNextLabel = null;
    if (failure === "refused") {
      return Promise.reject(new CarrierError("The carrier refused the label: address not deliverable.", true));
    }
    this.labels += 1;
    const trackingNumber = `1Z999AA1${String(this.labels).padStart(8, "0")}`;
    const label = {
      transactionId: `tx_${trackingNumber}`,
      carrier: rate.carrier,
      carrierCode: rate.carrierCode,
      service: rate.service,
      trackingNumber,
      labelUrl: `https://labels.example/${trackingNumber}.pdf`,
      trackingUrl: `https://ups.example/${trackingNumber}`,
      rateId: rate.providerRateId,
    };
    this.bought.push(label);
    return failure === "timeout" ? Promise.reject(new CarrierError("The carrier didn't respond.", false)) : Promise.resolve(label);
  }

  override findLabel(rate: LabelRate): Promise<PurchasedLabel | null> {
    return Promise.resolve(this.bought.find((label) => (label as PurchasedLabel & { rateId: string }).rateId === rate.providerRateId) ?? null);
  }

  override voidLabel(transactionId: string): Promise<boolean> {
    this.voided.push(transactionId);
    return Promise.resolve(true);
  }

  override track(carrier: string, trackingNumber: string): Promise<TrackingSnapshot> {
    if (this.failNextTracking) {
      this.failNextTracking = false;
      return Promise.reject(new CarrierError("The carrier didn't respond.", false));
    }
    return Promise.resolve({ carrier, trackingNumber, events: this.trackingEvents });
  }
}

const GB_RECIPIENT = { name: "Ada Obi", line1: "1 High Street", city: "Manchester", postalCode: "M1 1AA", countryCode: "GB" };
const US_RECIPIENT = { name: "Sam Lee", line1: "5 Main St", city: "New York", region: "NY", postalCode: "10001", countryCode: "US", phone: "+1 212 555 0100" };

describe("orders, packing and shipping", () => {
  let test: TestApp;
  let carrier: FakeShippo;
  let owner: string;
  let vendorId: string;
  let otherOwner: string;
  let gbOperator: string;
  let usOperator: string;
  let countryOps: string;
  let warehouseId: string;
  let wigId: string;
  let capId: string;
  let lotId: string;
  let presetId: string;

  const placeOrder = (deliveries: object[], token = owner) => test.http().post("/v1/vendor/orders").set(as(token)).send({ deliveries });
  const staff = (path: string, token = gbOperator) => test.http().post(`/v1/warehouse/orders/${path}`).set(as(token));
  const vendorAct = (id: string, body: object) => test.http().post(`/v1/vendor/orders/${id}/actions`).set(as(owner)).send(body);
  const balance = async () => (await test.http().get("/v1/vendor/wallet").set(as(owner)).expect(200)).body.balanceMinor as number;
  const lot = async () => (await query<{ quantity_available: number; quantity_reserved: number }>("SELECT quantity_available, quantity_reserved FROM stock_lots WHERE id = $1", [lotId]))[0]!;

  async function packed(lines = [{ productId: wigId, quantity: 1 }]): Promise<string> {
    const placed = await placeOrder([{ recipient: GB_RECIPIENT, lines }]).expect(201);
    const id = placed.body[0].id as string;
    for (const line of lines) {
      for (let unit = 0; unit < line.quantity; unit += 1) {
        await staff(`${id}/scans`)
          .send({ code: line.productId === wigId ? "4006381333931" : "CAP-RED" })
          .expect(200);
      }
    }
    await staff(`${id}/pack`).send({ presetId, weightGrams: 420 }).expect(200);
    return id;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    carrier = new FakeShippo();
    test.app.get(CarrierAccountsService).register("GB", carrier);
    owner = (await signUpAndVerify(test, "owner@orders.example")).accessToken;
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    otherOwner = (await signUpAndVerify(test, "other@orders.example")).accessToken;
    await makeVendorTrade((await test.http().get("/v1/auth/me").set(as(otherOwner))).body.vendorId);
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    gbOperator = await createStaff(test, "operator-gb@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    usOperator = await createStaff(test, "operator-us@gfn.test", "WAREHOUSE_OPERATOR", "US");
    countryOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
    const warehouse = await test
      .http()
      .post("/v1/warehouse/warehouses")
      .set(as(superAdmin))
      .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
      .expect(201);
    warehouseId = warehouse.body.id;
    await test.http().post(`/v1/warehouse/warehouses/${warehouseId}/locations`).set(as(gbOperator)).send({ code: "A-01", label: "Aisle A" }).expect(201);
    const [location] = await query<{ id: string }>("SELECT id FROM inventory_locations WHERE code = 'A-01'");
    const product = { countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL" };
    wigId = (
      await test
        .http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...product, code: "wig-1", name: "Body wave wig", hsCode: "670420", barcodes: [{ value: "4006381333931", symbology: "EAN13" }] })
        .expect(201)
    ).body.id;
    capId = (
      await test
        .http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...product, code: "cap-1", name: "Wig cap", barcodes: [{ value: "CAP-RED", symbology: "CODE128" }] })
        .expect(201)
    ).body.id;
    lotId = await seedStock({ vendorId, productId: wigId, warehouseId, quantity: 30, locationId: location!.id });
    await seedStock({ vendorId, productId: capId, warehouseId, quantity: 10 });
    presetId = (await test.http().post("/v1/admin/packaging/GB").set(as(superAdmin)).send({ code: "box-s", label: "Small box", kind: "BOX", lengthMm: 300, widthMm: 200, heightMm: 100 }).expect(201))
      .body.id;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("placing orders", () => {
    it("refuses an order the wallet can't cover and leaves stock untouched", async () => {
      const refused = await placeOrder([{ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 2 }] }]).expect(409);
      expect(refused.body.code).toBe("insufficient_funds");
      expect(await lot()).toEqual({ quantity_available: 30, quantity_reserved: 0 });
    });

    it("reserves stock and takes the fulfilment fee", async () => {
      await fundWallet(vendorId, 20_000);
      const placed = await placeOrder([{ externalReference: "SHOP-1001", recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 2 }] }]).expect(201);
      expect(placed.body).toHaveLength(1);
      expect(placed.body[0]).toMatchObject({ status: "PENDING_PACKING", source: "PORTAL", countryCode: "GB", totalUnits: 2, externalReference: "SHOP-1001" });
      expect(placed.body[0].reference).toMatch(/^ORD-GB-[A-Z2-9]{7}$/);
      expect(await lot()).toEqual({ quantity_available: 28, quantity_reserved: 2 });
      expect(await balance()).toBe(20_000 - 398);
      const detail = await test.http().get(`/v1/vendor/orders/${placed.body[0].id}`).set(as(owner)).expect(200);
      expect(detail.body).toMatchObject({ recipient: { name: "Ada Obi", postalCode: "M1 1AA" }, charges: { currency: "GBP", fulfilmentFeeMinor: 398 }, actions: ["CANCEL"], rates: [], deliveryPreference: "CHEAPEST" });
      expect(detail.body.lines[0].locations).toEqual([]);
      const [row] = await query<{ recipient_encrypted: string }>("SELECT recipient_encrypted FROM orders WHERE id = $1", [placed.body[0].id]);
      expect(row!.recipient_encrypted).not.toContain("High Street");
      await placeOrder([{ externalReference: "SHOP-1001", recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }] }]).expect(400);
      await test.http().get(`/v1/vendor/orders/${placed.body[0].id}`).set(as(otherOwner)).expect(404);
    });

    it("estimates delivery prices from the products' sizes before the order is placed", async () => {
      const estimate = (body: object) => test.http().post("/v1/vendor/orders/shipping-estimate").set(as(owner)).send(body);
      const rough = await estimate({ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 2 }] }).expect(200);
      expect(rough.body).toMatchObject({ currency: "GBP", sized: false, productsWithoutSize: ["Body wave wig"] });
      expect((rough.body as ShippingEstimateView).rates.map((rate) => [rate.chargeMinor, rate.tags, rate.preferred])).toEqual([
        [704, ["CHEAPEST"], true],
        [2199, ["FASTEST"], false],
      ]);
      const [product] = await query<{ weight_grams: number }>("SELECT weight_grams FROM products WHERE id = $1", [wigId]);
      expect(carrier.quotes.at(-1)).toMatchObject({ parcel: { weightGrams: product!.weight_grams * 2 + 150 }, from: { name: "Acme Goods" }, to: { postalCode: GB_RECIPIENT.postalCode } });

      await query("UPDATE products SET length_mm = 200, width_mm = 150, height_mm = 40 WHERE id = $1", [wigId]);
      const sized = await estimate({ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }], deliveryPreference: "FASTEST" }).expect(200);
      expect(sized.body).toMatchObject({ sized: true, productsWithoutSize: [], boxLabel: "Small box" });
      expect(sized.body.rates[0]).toMatchObject({ service: "Next Day", preferred: true });
      await query("UPDATE products SET length_mm = NULL, width_mm = NULL, height_mm = NULL WHERE id = $1", [wigId]);

      await estimate({ recipient: US_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }] }).expect(400);
      expect((await estimate({ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1000 }] }).expect(409)).body.code).toBe("insufficient_stock");
      await test.http().post("/v1/vendor/orders/shipping-estimate").set(as(otherOwner)).send({ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }] }).expect(400);
    });

    it("keeps the seller's delivery choice, and refuses one it doesn't know", async () => {
      const placed = await placeOrder([{ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }], deliveryPreference: "FASTEST" }]).expect(201);
      expect(placed.body[0].deliveryPreference).toBe("FASTEST");
      await test.http().post(`/v1/vendor/orders/${placed.body[0].id}/actions`).set(as(owner)).send({ action: "CANCEL", reason: "CUSTOMER_CANCELLED" }).expect(200);
      await placeOrder([{ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }], deliveryPreference: "SLOWEST" }]).expect(400);
    });

    it("checks the address is in the order's country, the postcode and stock", async () => {
      const abroad = await placeOrder([{ recipient: US_RECIPIENT, lines: [{ productId: wigId, quantity: 1 }] }]).expect(400);
      expect(abroad.body.fieldErrors["deliveries.0.recipient.countryCode"]).toEqual(["Use an address in United Kingdom"]);
      const postcode = await placeOrder([{ recipient: { ...GB_RECIPIENT, postalCode: "NOPE" }, lines: [{ productId: wigId, quantity: 1 }] }]).expect(400);
      expect(Object.keys(postcode.body.fieldErrors)).toEqual(["deliveries.0.recipient.postalCode"]);
      const stock = await placeOrder([{ recipient: GB_RECIPIENT, lines: [{ productId: capId, quantity: 11 }] }]).expect(409);
      expect(stock.body).toMatchObject({ code: "insufficient_stock", message: expect.stringContaining("Wig cap") });
    });

    it("splits a request with several deliveries into one order each, all in the same country", async () => {
      const placed = await placeOrder([
        { recipient: GB_RECIPIENT, lines: [{ productId: capId, quantity: 1 }] },
        { recipient: { name: "Ben Ade", line1: "2 Low Road", city: "Leeds", postalCode: "LS1 1AA" }, lines: [{ productId: wigId, quantity: 1 }] },
      ]).expect(201);
      const orders = placed.body as OrderSummaryView[];
      expect(orders.map((order) => order.countryCode)).toEqual(["GB", "GB"]);
      const groups = await query<{ group_id: string; customs_required: boolean; destination_country_code: string }>(
        "SELECT group_id, customs_required, destination_country_code FROM orders WHERE id = ANY($1::uuid[])",
        [orders.map((order) => order.id)],
      );
      expect(groups[0]!.group_id).toBe(groups[1]!.group_id);
      expect(groups.map((group) => [group.customs_required, group.destination_country_code])).toEqual([
        [false, "GB"],
        [false, "GB"],
      ]);
    });

    it("estimates the fee before placing", async () => {
      const estimate = await test.http().post("/v1/vendor/orders/estimate").set(as(owner)).send({ units: 3 }).expect(200);
      expect(estimate.body).toMatchObject({ currency: "GBP", fulfilmentFeeMinor: 497 });
    });
  });

  describe("packing", () => {
    let orderId: string;

    beforeAll(async () => {
      orderId = (
        await placeOrder([
          {
            recipient: GB_RECIPIENT,
            lines: [
              { productId: wigId, quantity: 2 },
              { productId: capId, quantity: 1 },
            ],
          },
        ]).expect(201)
      ).body[0].id;
    });

    it("keeps orders inside the operator's country", async () => {
      await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(usOperator)).expect(404);
      await staff(`${orderId}/scans`, usOperator).send({ code: "CAP-RED" }).expect(404);
      const detail = await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator)).expect(200);
      expect((detail.body as OrderDetailView).lines.find((line) => line.productCode === "WIG-1")!.locations).toEqual(["A-01"]);
      expect(detail.body.actions).toEqual(["RECORD_PACK", "HOLD"]);
    });

    it("won't record a pack until every unit has been scanned on the server", async () => {
      const early = await staff(`${orderId}/pack`).send({ presetId, weightGrams: 900 }).expect(409);
      expect(early.body.message).toMatch(/Still to scan: Wig cap, Body wave wig\./);
      await staff(`${orderId}/scans`).send({ code: "0000000000000" }).expect(400);
      const lines = ((await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator)).expect(200)).body as OrderDetailView).lines;
      const capLine = lines.find((line) => line.productCode === "CAP-1")!.id;
      const wigLine = lines.find((line) => line.productCode === "WIG-1")!.id;
      const barcoded = await staff(`${orderId}/lines/${wigLine}/confirm`).expect(409);
      expect(barcoded.body.message).toMatch(/Scan the barcode on Body wave wig/);
      const [capBarcode] = await query<{ id: string; product_id: string; vendor_id: string }>("DELETE FROM product_barcodes WHERE value = 'CAP-RED' RETURNING id, product_id, vendor_id");
      const confirmed = await staff(`${orderId}/lines/${capLine}/confirm`).expect(200);
      expect(confirmed.body).toMatchObject({ productName: "Wig cap", scannedQuantity: 1, complete: true });
      const capAgain = await staff(`${orderId}/lines/${capLine}/confirm`).expect(400);
      expect(capAgain.body.fieldErrors.lineId[0]).toMatch(/already scanned/);
      await query("INSERT INTO product_barcodes (id, product_id, vendor_id, value, symbology) VALUES ($1, $2, $3, 'CAP-RED', 'CODE128')", [capBarcode!.id, capBarcode!.product_id, capBarcode!.vendor_id]);
      const scannedAgain = await staff(`${orderId}/scans`).send({ code: "CAP-RED" }).expect(400);
      expect(scannedAgain.body.fieldErrors.code[0]).toMatch(/already scanned/);
      const timeline = ((await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator)).expect(200)).body as OrderDetailView).events;
      expect(timeline.some((event) => event.type === "order.unit_confirmed" && event.description === "Wig cap checked by hand (1 of 1)")).toBe(true);
      await staff(`${orderId}/scans`).send({ code: "4006381333931" }).expect(200);
      const last = await staff(`${orderId}/scans`).send({ code: "4006381333931" }).expect(200);
      expect(last.body).toMatchObject({ productName: "Body wave wig", scannedQuantity: 2, quantity: 2, complete: true });
      await staff(`${orderId}/pack`)
        .send({ presetId, dimensions: { lengthMm: 1, widthMm: 1, heightMm: 1 }, weightGrams: 900 })
        .expect(400);
      const done = await staff(`${orderId}/pack`).send({ presetId, weightGrams: 900 }).expect(200);
      expect(done.body).toMatchObject({ status: "PACKING_COMPLETED", pack: { presetLabel: "Small box", lengthMm: 300, weightGrams: 900 } });
      const custody = await query<{ type: string }>("SELECT type FROM custody_events WHERE lot_id = $1 AND type IN ('PICKED','PACKED') ORDER BY sequence", [lotId]);
      expect(custody.map((event) => event.type)).toEqual(["PICKED", "PACKED"]);
    });

    it("charges shipping with the markup, then buys the label", async () => {
      const rated = await staff(`${orderId}/actions`).send({ action: "FETCH_RATES" }).expect(200);
      expect(rated.body.status).toBe("AWAITING_SHIPPING_SELECTION");
      expect((rated.body as OrderDetailView).rates.map((rate) => [rate.chargeMinor, rate.tags, rate.preferred])).toEqual([
        [704, ["CHEAPEST"], true],
        [2199, ["FASTEST"], false],
      ]);
      expect(carrier.quotes.at(-1)).toMatchObject({ parcel: { lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 900 }, customs: null, from: { name: "Acme Goods", city: "Manchester", phone: "+44 161 000 0000" } });
      const before = await balance();
      const ground = rated.body.rates[0].id as string;
      const labelled = await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: ground }).expect(200);
      expect(labelled.body).toMatchObject({
        status: "LABEL_PURCHASED",
        charges: { shippingChargeMinor: 704 },
        label: { carrier: "UPS", service: "Ground", labelUrl: expect.stringContaining("labels.example") },
      });
      expect(await balance()).toBe(before - 704);
      const vendorView = await test.http().get(`/v1/vendor/orders/${orderId}`).set(as(owner)).expect(200);
      expect(vendorView.body.label.labelUrl).toBeNull();
      expect(vendorView.body.actions).toEqual(["REQUEST_CANCELLATION"]);
    });

    it("hands the parcel over, ships the stock and follows the carrier to delivery", async () => {
      const reserved = (await lot()).quantity_reserved;
      const highValue = `jsonb_set(config, '{partners,highValueOrderMinor}', to_jsonb($1::int))`;
      await query(`UPDATE countries SET config = ${highValue} WHERE code = 'GB'`, [5_000]);
      const unsealed = await staff(`${orderId}/actions`).send({ action: "HAND_OFF" }).expect(400);
      expect(unsealed.body.fieldErrors.sealNumber[0]).toMatch(/numbered tamper seal/);
      const handed = await staff(`${orderId}/actions`).send({ action: "HAND_OFF", sealNumber: "SEAL-0042" }).expect(200);
      await query(`UPDATE countries SET config = ${highValue} WHERE code = 'GB'`, [25_000]);
      expect(handed.body).toMatchObject({ status: "HANDED_OFF", sealRequired: true, sealNumber: "SEAL-0042" });
      expect((await lot()).quantity_reserved).toBe(reserved - 2);
      const tracking = handed.body.label.trackingNumber as string;
      carrier.trackingEvents = [
        { status: "IN_TRANSIT", description: "Departed facility", occurredAt: "2026-10-26T08:00:00.000Z", location: "Manchester, GB" },
        { status: "DELIVERED", description: "Delivered to front door", occurredAt: "2026-10-27T11:00:00.000Z", location: "Manchester, GB" },
      ];
      const body = { event: "track_updated", data: { carrier: "ups", tracking_number: tracking } };
      await test
        .http()
        .post(`/v1/webhooks/shippo/GB/${"x".repeat(40)}`)
        .send(body)
        .expect(404);
      carrier.failNextTracking = true;
      await test.http().post(`/v1/webhooks/shippo/GB/${CARRIER_WEBHOOK_TOKEN}`).send(body).expect(502);
      await test.http().post(`/v1/webhooks/shippo/GB/${CARRIER_WEBHOOK_TOKEN}`).send(body).expect(200);
      await test.http().post(`/v1/webhooks/shippo/GB/${CARRIER_WEBHOOK_TOKEN}`).send(body).expect(200);
      const delivered = await test.http().get(`/v1/vendor/orders/${orderId}`).set(as(owner)).expect(200);
      expect(delivered.body.status).toBe("DELIVERED");
      expect((delivered.body as OrderDetailView).events.filter((event) => event.source === "CARRIER")).toHaveLength(2);
      const publicView = await test.http().get(`/v1/track/${tracking}`).expect(200);
      expect(publicView.body).toMatchObject({ status: "DELIVERED", destination: { city: "Manchester", countryCode: "GB" } });
      expect(JSON.stringify(publicView.body)).not.toMatch(/Ada|High Street|M1 1AA/);
      await test.http().get("/v1/track/NOPE000000").expect(404);
    });
  });

  describe("paying for shipping", () => {
    it("waits for funds, then lets the vendor pay and buys the label", async () => {
      const orderId = await packed();
      await staff(`${orderId}/actions`).send({ action: "FETCH_RATES" }).expect(200);
      const rates = (await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator))).body.rates as Array<{ id: string }>;
      const spend = await balance();
      await query(
        "INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) SELECT id, vendor_id, 'MANUAL_DEBIT', $2, 0, 'Test drain', 'drain-1' FROM wallets WHERE vendor_id = $1",
        [vendorId, -spend],
      );
      const waiting = await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: rates[1]!.id }).expect(200);
      expect(waiting.body.status).toBe("AWAITING_WALLET_FUNDING");
      expect(test.email.lastTo("owner@orders.example")!.subject).toMatch(/waiting for shipping funds/);
      const vendorView = (await test.http().get(`/v1/vendor/orders/${orderId}`).set(as(owner)).expect(200)).body as OrderDetailView;
      expect(vendorView.rates.map((rate) => [rate.service, rate.chargeMinor])).toEqual([["Next Day", 2199]]);
      const short = await vendorAct(orderId, { action: "PAY_SHIPPING" }).expect(409);
      expect(short.body.code).toBe("insufficient_funds");
      await fundWallet(vendorId, 5_000);
      const paid = await vendorAct(orderId, { action: "PAY_SHIPPING" }).expect(200);
      expect(paid.body).toMatchObject({ status: "LABEL_PURCHASED", charges: { shippingChargeMinor: 2199 } });
      expect(await balance()).toBe(5_000 - 2199);
    });

    it("returns the shipping charge when the carrier refuses the label", async () => {
      await fundWallet(vendorId, 5_000);
      const orderId = await packed();
      const rated = await staff(`${orderId}/actions`).send({ action: "FETCH_RATES" }).expect(200);
      const before = await balance();
      carrier.failNextLabel = "refused";
      const failed = await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(502);
      expect(failed.body.message).toMatch(/returned to the wallet/);
      const after = await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator)).expect(200);
      expect(after.body).toMatchObject({ status: "AWAITING_SHIPPING_SELECTION", rates: [], charges: { shippingChargeMinor: null, refundedMinor: 704 } });
      expect(await balance()).toBe(before);
      await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(400);
    });
  });

  describe("unconfirmed labels", () => {
    it("keeps the payment when the carrier doesn't confirm, then picks up the label instead of buying twice", async () => {
      await fundWallet(vendorId, 5_000);
      const orderId = await packed();
      const rated = await staff(`${orderId}/actions`).send({ action: "FETCH_RATES" }).expect(200);
      const before = await balance();
      const boughtBefore = carrier.bought.length;
      carrier.failNextLabel = "timeout";
      const pending = await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(502);
      expect(pending.body.message).toMatch(/stays paid/);
      const paid = await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(gbOperator)).expect(200);
      expect(paid.body).toMatchObject({ status: "SHIPPING_PAID", actions: expect.arrayContaining(["RETRY_LABEL"]) as unknown, charges: { refundedMinor: 0 } });
      expect(await balance()).toBe(before - 704);
      const retried = await staff(`${orderId}/actions`).send({ action: "RETRY_LABEL" }).expect(200);
      expect(retried.body.status).toBe("LABEL_PURCHASED");
      expect(carrier.bought.length).toBe(boughtBefore + 1);
    });
  });

  describe("cancelling", () => {
    it("lets the vendor cancel before packing and puts everything back", async () => {
      const before = { balance: await balance(), lot: await lot() };
      const placed = await placeOrder([{ recipient: GB_RECIPIENT, lines: [{ productId: wigId, quantity: 3 }] }]).expect(201);
      const cancelled = await vendorAct(placed.body[0].id, { action: "CANCEL", reason: "CUSTOMER_CANCELLED" }).expect(200);
      expect(cancelled.body).toMatchObject({ status: "CANCELLED", charges: { refundedMinor: 497 }, actions: [] });
      expect(await balance()).toBe(before.balance);
      expect(await lot()).toEqual(before.lot);
    });

    it("needs a request once packing has started, and staff decide it", async () => {
      await fundWallet(vendorId, 5_000);
      const orderId = await packed();
      await vendorAct(orderId, { action: "CANCEL", reason: "CUSTOMER_CANCELLED" }).expect(409);
      await vendorAct(orderId, { action: "REQUEST_CANCELLATION", reason: "WRONG_ITEMS", note: "Sent the wrong size" }).expect(200);
      await vendorAct(orderId, { action: "REQUEST_CANCELLATION", reason: "WRONG_ITEMS" }).expect(409);
      const queue = await test.http().get("/v1/warehouse/orders/cancellation-requests").set(as(countryOps)).expect(200);
      expect((queue.body as OrderSummaryView[]).map((order) => order.id)).toContain(orderId);
      await staff(`${orderId}/cancellation-decision`, gbOperator).send({ approve: true, note: "Operators can't decide this" }).expect(404);
      await staff(`${orderId}/cancellation-decision`, countryOps).send({ approve: false, note: "Already sealed for collection" }).expect(200);
      expect(test.email.lastTo("owner@orders.example")!.subject).toMatch(/can't be cancelled/);
      await vendorAct(orderId, { action: "REQUEST_CANCELLATION", reason: "CUSTOMER_CANCELLED" }).expect(200);
      const before = await balance();
      const approved = await staff(`${orderId}/cancellation-decision`, countryOps).send({ approve: true, note: "Unpacked and back on the shelf" }).expect(200);
      expect(approved.body).toMatchObject({ status: "CANCELLED", cancellation: { status: "APPROVED" } });
      expect(await balance()).toBe(before + 299);
      const released = await query<{ type: string }>("SELECT type FROM custody_events WHERE lot_id = $1 ORDER BY sequence DESC LIMIT 1", [lotId]);
      expect(released[0]!.type).toBe("RELEASED");
    });

    it("voids the label when staff cancel after it was bought", async () => {
      await fundWallet(vendorId, 5_000);
      const orderId = await packed();
      const rated = await staff(`${orderId}/actions`).send({ action: "FETCH_RATES" }).expect(200);
      await staff(`${orderId}/actions`).send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(200);
      const before = await balance();
      await staff(`${orderId}/actions`).send({ action: "CANCEL", reason: "ADDRESS_PROBLEM", note: "Recipient moved away" }).expect(404);
      const cancelled = await staff(`${orderId}/actions`, countryOps).send({ action: "CANCEL", reason: "ADDRESS_PROBLEM", note: "Recipient moved away" }).expect(200);
      expect(cancelled.body.label.voidRequestedAt).not.toBeNull();
      expect(carrier.voided).toHaveLength(1);
      expect(await balance()).toBe(before + 299 + 704);
    });
  });

  describe("holds and integrity", () => {
    it("holds and releases back to packing with scans cleared", async () => {
      const orderId = await packed();
      await staff(`${orderId}/actions`).send({ action: "HOLD", reason: "short" }).expect(400);
      const held = await staff(`${orderId}/actions`).send({ action: "HOLD", reason: "Box looks crushed, checking contents" }).expect(200);
      expect(held.body).toMatchObject({ status: "ON_HOLD", holdReason: "Box looks crushed, checking contents", actions: ["RELEASE"] });
      expect((await test.http().get(`/v1/vendor/orders/${orderId}`).set(as(owner))).body.actions).toEqual(["CANCEL"]);
      const released = await staff(`${orderId}/actions`).send({ action: "RELEASE" }).expect(200);
      expect(released.body).toMatchObject({ status: "PENDING_PACKING", pack: null });
      expect(released.body.lines[0].scannedQuantity).toBe(0);
    });

    it("hides the recipient from staff who don't handle orders", async () => {
      const finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
      const [order] = await query<{ id: string }>("SELECT id FROM orders ORDER BY created_at LIMIT 1");
      const view = await test.http().get(`/v1/warehouse/orders/${order!.id}`).set(as(finance)).expect(200);
      expect(view.body.recipient).toMatchObject({ name: "A…", line1: "Hidden", postalCode: "" });
      const list = await test.http().get("/v1/warehouse/orders?status=CANCELLED").set(as(finance)).expect(200);
      expect((list.body as OrderSummaryView[]).every((row) => row.recipientName.endsWith("…"))).toBe(true);
      const operator = await test.http().get(`/v1/warehouse/orders/${order!.id}`).set(as(gbOperator)).expect(200);
      expect(operator.body.recipient.line1).toBe("1 High Street");
    });

    it("refuses status jumps and history edits in the database", async () => {
      const [cancelled] = await query<{ id: string }>("SELECT id FROM orders WHERE status = 'CANCELLED' LIMIT 1");
      await expect(query("UPDATE orders SET status = 'PENDING_PACKING' WHERE id = $1", [cancelled!.id])).rejects.toThrow(/cannot move from CANCELLED/);
      await expect(query("UPDATE orders SET vendor_id = gen_random_uuid() WHERE id = $1", [cancelled!.id])).rejects.toThrow();
      await expect(query("UPDATE order_events SET description = 'edited'")).rejects.toThrow(/append-only/);
      await expect(query("DELETE FROM orders WHERE id = $1", [cancelled!.id])).rejects.toThrow(/append-only/);
    });
  });

  describe("spreadsheet import", () => {
    const header = "order_reference,recipient_name,company,phone,email,address_line1,address_line2,city,region,postal_code,country,product_code,quantity";

    it("creates the good orders and explains the rest", async () => {
      await fundWallet(vendorId, 5_000);
      const csv = [
        header,
        "CSV-1,Ada Obi,,,,1 High Street,,Manchester,,M1 1AA,GB,wig-1,1",
        "CSV-1,,,,,,,,,,,cap-1,1",
        "CSV-2,Ben Ade,,,,2 Low Road,,Leeds,,LS1 1AA,GB,nope-9,1",
        "CSV-3,Cara Doe,,,,3 Mid Lane,,Leeds,,INVALID,GB,wig-1,1",
        "CSV-4,Dan Eze,,,,4 Side St,,Leeds,,LS2 2BB,GB,wig-1,zero",
      ].join("\n");
      const result = await test.http().post("/v1/vendor/orders/imports").set(as(owner)).send({ filename: "orders.csv", csv }).expect(201);
      expect(result.body).toMatchObject({ ordersCreated: 1, ordersFailed: 2, rowErrors: [{ row: 6 }] });
      const byReference = Object.fromEntries((result.body as ImportResultView).results.map((item) => [item.reference, item]));
      expect(byReference["CSV-1"]!.orderReference).toMatch(/^ORD-GB-/);
      expect(byReference["CSV-2"]!.message).toMatch(/Unknown product code NOPE-9/);
      expect(byReference["CSV-3"]!.message).toMatch(/postalCode/);
      const history = await test.http().get("/v1/vendor/orders/imports").set(as(owner)).expect(200);
      expect(history.body[0].id).toBe(result.body.id);
      await test.http().post("/v1/vendor/orders/imports").set(as(owner)).send({ filename: "bad.csv", csv: "reference,name\n1,2" }).expect(400);
      const busy = await test.app
        .get(JobLockService)
        .runExclusive(`order-import:${vendorId}`, 10_000, () => test.http().post("/v1/vendor/orders/imports").set(as(owner)).send({ filename: "orders.csv", csv }));
      expect(busy!.status).toBe(409);
    });
  });

  describe("integration API", () => {
    let key: string;

    it("issues keys to the owner, shown once", async () => {
      const created = await test.http().post("/v1/vendor/integrations/keys").set(as(owner)).send({ name: "Shopify store" }).expect(201);
      key = created.body.key;
      expect(key).toMatch(/^gfn_test_[0-9a-f]{16}\.[0-9a-f]{64}$/);
      const listed = await test.http().get("/v1/vendor/integrations/keys").set(as(owner)).expect(200);
      expect(listed.body[0]).not.toHaveProperty("key");
      expect(listed.body[0].prefix).toBe(key.split(".")[0]);
      const [stored] = await query<{ secret_hash: string }>("SELECT secret_hash FROM api_keys LIMIT 1");
      expect(stored!.secret_hash).not.toBe(key.split(".")[1]);
    });

    it("places orders idempotently by the store's reference", async () => {
      await fundWallet(vendorId, 5_000);
      const body = { country: "GB", externalReference: "#5001", recipient: GB_RECIPIENT, lines: [{ productCode: "wig-1", quantity: 1 }] };
      await test.http().post("/v1/integration/orders").send(body).expect(401);
      await test
        .http()
        .post("/v1/integration/orders")
        .set("X-Api-Key", `${key.slice(0, -1)}${key.endsWith("0") ? "1" : "0"}`)
        .send(body)
        .expect(401);
      const first = await test.http().post("/v1/integration/orders").set("X-Api-Key", key).send(body).expect(201);
      const again = await test.http().post("/v1/integration/orders").set("Authorization", `Bearer ${key}`).send(body).expect(200);
      expect(again.body.reference).toBe(first.body.reference);
      expect(first.body).toMatchObject({ externalReference: "#5001", status: "PENDING_PACKING" });
      const found = await test
        .http()
        .get(`/v1/integration/orders/${encodeURIComponent("#5001")}`)
        .set("X-Api-Key", key)
        .expect(200);
      expect(found.body.reference).toBe(first.body.reference);
      const [order] = await query<{ source: string; api_key_id: string | null }>("SELECT source, api_key_id FROM orders WHERE reference = $1", [first.body.reference]);
      expect(order).toMatchObject({ source: "API" });
      expect(order!.api_key_id).not.toBeNull();
    });

    it("returns the same order when a store retries at the same moment", async () => {
      await fundWallet(vendorId, 5_000);
      const body = { country: "GB", externalReference: "#5002", recipient: GB_RECIPIENT, lines: [{ productCode: "cap-1", quantity: 1 }] };
      const responses = await Promise.all([1, 2, 3].map(() => test.http().post("/v1/integration/orders").set("X-Api-Key", key).send(body)));
      expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(responses.map((response) => (response.body as { reference: string }).reference)).size).toBe(1);
    });

    it("stops working the moment it is revoked", async () => {
      const keys = (await test.http().get("/v1/vendor/integrations/keys").set(as(owner))).body as Array<{ id: string }>;
      await test.http().delete(`/v1/vendor/integrations/keys/${keys[0]!.id}`).set(as(otherOwner)).expect(404);
      await test.http().delete(`/v1/vendor/integrations/keys/${keys[0]!.id}`).set(as(owner)).expect(200);
      await test
        .http()
        .get(`/v1/integration/orders/${encodeURIComponent("#5001")}`)
        .set("X-Api-Key", key)
        .expect(401);
    });
  });
});
