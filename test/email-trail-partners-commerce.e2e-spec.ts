import { StorefrontRefundsService } from "../src/modules/commerce/orders/storefront-refunds.service";
import { PaymentEventsService } from "../src/modules/finance/payments/payment-events.service";
import { SYSTEM_ACTOR } from "../src/infrastructure/audit/audit.service";
import type { ClaimView, PartnerDetailView, ShoppingRequestView, TransferView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile, WEB_ORIGIN } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";
import { handOff, openStore, paidOrder, SHIP_TO } from "./store-helpers";

const WEB = "http://localhost:3000";
const LEAD_A = "lead-a@trail.test";
const LEAD_B = "lead-b@trail.test";
const OWNER = "owner@trail.example";
const BUYER = "buyer@trail.example";
const SHOPPER = "shopper@trail.example";

describe("email trail: partners, claims, storefront, shopping and support", () => {
  let test: TestApp;
  let superAdmin: string;
  let compliance: string;
  let financeA: string;
  let financeB: string;
  let ops: string;
  let owner: string;
  let vendorId: string;
  let productId: string;
  let a: { token: string; partnerId: string; hubId: string };
  let b: { token: string; partnerId: string; hubId: string };

  const kinds = (to: string, area: RegExp) => test.email.sent.filter((message) => message.to === to && area.test(message.kind ?? "")).map((message) => message.kind);
  const post = (token: string, path: string, body: object = {}) => test.http().post(path).set(as(token)).send(body);
  const decide = (token: string, partnerId: string, decision: string, reason: string) => post(token, `/v1/admin/partners/${partnerId}/decisions/${decision}`, { reason });

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    const staff = async (email: string, role: string, country: string | null = null) => {
      await flushRateLimits();
      return createStaff(test, email, role, country);
    };
    superAdmin = await staff("super@trail.test", "SUPER_ADMIN");
    compliance = await staff("compliance@trail.test", "COMPLIANCE");
    financeA = await staff("finance-a@trail.test", "FINANCE_ADMIN");
    financeB = await staff("finance-b@trail.test", "FINANCE_ADMIN");
    ops = await staff("ops@trail.test", "COUNTRY_OPS", "GB");
    await flushRateLimits();
    owner = (await signUpAndVerify(test, OWNER)).accessToken;
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    productId = (
      await post(owner, "/v1/vendor/products", {
        code: "trail-1",
        name: "Lace wig",
        countryOfOrigin: "CN",
        declaredValueMinor: 4_500,
        weightGrams: 350,
        storageTier: "SMALL",
        barcodes: [{ value: "TRAIL-1", symbology: "CODE128" }],
      }).expect(201)
    ).body.id;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("emails a partner at each step from application to a paused and reopened hub", async () => {
    const flow = new PartnerFlow(test);
    a = await flow.onboard(LEAD_A, "Ada Obi", compliance, superAdmin);
    expect(kinds(LEAD_A, /^partners\./)).toEqual(["partners.application_submitted", "partners.check_accepted", "partners.check_accepted", "partners.check_accepted", "partners.approved"]);
    expect(test.email.lastTo(LEAD_A)!.action).toEqual({ label: "Open your partnership", url: `${WEB}/admin/partnership` });
    const recorded = await post(financeA, `/v1/admin/partners/${a.partnerId}/securities`, { kind: "DEPOSIT", amountMinor: 3_000, reference: "BACS 2026-10-27" }).expect(201);
    await post(financeB, `/v1/admin/partners/${a.partnerId}/securities/${(recorded.body as PartnerDetailView).securities[0]!.id}/confirm`).expect(201);
    await decide(compliance, a.partnerId, "SUSPEND", "Checking a delivery complaint.").expect(201);
    await decide(superAdmin, a.partnerId, "REINSTATE", "Complaint resolved.").expect(201);
    expect(kinds(LEAD_A, /^partners\./).slice(-3)).toEqual(["partners.deposit_confirmed", "partners.suspended", "partners.reinstated"]);
    expect(test.email.lastTo(LEAD_A)!.text).toContain("Your hub is open again");
    b = await flow.onboard(LEAD_B, "Bisi Ade", compliance, superAdmin);
  });

  it("tells both hubs and the vendor what happens when stock goes missing in a transfer", async () => {
    const lotId = await seedStock({ vendorId, productId, warehouseId: a.hubId, quantity: 6 });
    const transfer = (await post(ops, "/v1/admin/transfers", { fromWarehouseId: a.hubId, toWarehouseId: b.hubId, reason: "Moving stock closer to buyers." }).expect(201)).body as TransferView;
    const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
    await post(a.token, `/v1/partner/transfers/${transfer.id}/dispatch`, { carrier: "DPD", trackingNumber: "DPD123456", sealNumber: "SEAL-1", photoFileIds: [photo] }).expect(200);
    expect(kinds(LEAD_B, /^transfers\./)).toEqual(["transfers.incoming"]);
    expect(test.email.lastTo(LEAD_B)!.text).toContain("Tracking number: DPD123456");
    const lineId = ((await test.http().get(`/v1/partner/transfers/${transfer.id}`).set(as(b.token)).expect(200)).body as TransferView).lines[0]!.id;
    await post(b.token, `/v1/partner/transfers/${transfer.id}/receive`, { lines: [{ lineId, quantityReceived: 5 }] }).expect(200);
    expect(kinds(OWNER, /^claims\./)).toEqual(["claims.opened"]);
    expect(test.email.lastTo(OWNER)!.text).toContain("1 unit of Lace wig didn't arrive");
    const [claim] = await query<{ id: string }>("SELECT id FROM custody_claims WHERE lot_id = $1", [lotId]);
    await post(ops, `/v1/admin/claims/${claim!.id}/assessment`, { liability: "PARTNER", amountMinor: 4_500, writeOff: false, note: "The hub packed five." }).expect(200);
    await post(financeA, `/v1/admin/claims/${claim!.id}/decision`, { approve: true, note: "Credit the vendor." }).expect(200);
    expect(kinds(OWNER, /^claims\./)).toEqual(["claims.opened", "claims.settled"]);
    const settled = test.email.lastTo(OWNER)!;
    expect(settled.text).toContain("£45.00 of wallet credit");
    expect(settled.action).toEqual({ label: "See your claims", url: `${WEB}/claims` });
    await seedStock({ vendorId, productId, warehouseId: a.hubId, quantity: 2 });
    const cancelled = (await post(ops, "/v1/admin/transfers", { fromWarehouseId: a.hubId, toWarehouseId: b.hubId, reason: "Rebalancing." }).expect(201)).body as TransferView;
    await post(ops, `/v1/admin/transfers/${cancelled.id}/cancel`).expect(200);
    expect(kinds(LEAD_A, /^(transfers|claims)\./)).toEqual(["transfers.requested", "claims.partner_assessed", "claims.partner_decided", "transfers.requested", "transfers.cancelled"]);
  });

  it("confirms a vendor's own report and tells them the decision", async () => {
    const lotId = await seedStock({ vendorId, productId, warehouseId: a.hubId, quantity: 3 });
    const photo = await uploadVerifiedFile(test, owner, "GENERAL_ATTACHMENT");
    const report = (await post(owner, "/v1/vendor/claims", { lotId, kind: "DAMAGE", quantity: 1, description: "One wig arrived crushed.", fileIds: [photo] }).expect(201)).body as ClaimView;
    await post(financeA, `/v1/admin/claims/${report.id}/decision`, { approve: false, note: "The photos show the box was fine." }).expect(200);
    expect(kinds(OWNER, /^claims\./).slice(-2)).toEqual(["claims.received", "claims.rejected"]);
  });

  it("emails the buyer and the store owner through a store order, its tracking and a dispute", async () => {
    const store = await openStore(test, "trail");
    const order = await paidOrder(test, store, BUYER);
    await query("UPDATE orders SET tracking_number = 'TRK123456' WHERE id = (SELECT fulfilment_order_id FROM storefront_orders WHERE id = $1)", [order.id]);
    await handOff(test, order.id);
    await test.app.get(StorefrontRefundsService).refund(order.id, 1_000, `trail:${order.id}`, SYSTEM_ACTOR, "Scuffed box");
    expect(kinds(BUYER, /^store\./)).toEqual(["store.order_confirmed", "store.order_shipped", "store.order_refunded"]);
    const shipped = test.email.sent.find((message) => message.kind === "store.order_shipped")!;
    expect(shipped.action).toEqual({ label: "Track your parcel", url: `${WEB}/track/TRK123456` });
    const event = (stage: string) =>
      test.app
        .get(PaymentEventsService)
        .handle("SANDBOX", "GB", {
          kind: "PAYMENT_DISPUTED",
          eventId: `${stage}-${order.id}`,
          paymentId: `sandbox_payment_${order.id}`,
          amountMinor: 100,
          currency: "GBP",
          stage,
          type: "test",
          payload: {},
        } as never);
    await event("OPENED");
    await event("WON");
    expect(kinds("trail@store.example", /^store\./)).toEqual(["store.new_order", "store.payment_disputed", "store.dispute_closed"]);
  });

  it("emails a shopper from request to delivery", async () => {
    const operator = await createStaff(test, "operator@trail.test", "WAREHOUSE_OPERATOR", "GB");
    const warehouseId = (
      await post(superAdmin, "/v1/warehouse/warehouses", { countryCode: "GB", code: "TRL-1", name: "Trail", addressLines: ["Unit 4"], city: "Manchester", postalCode: "M17 1AA" }).expect(201)
    ).body.id;
    const boxId = (await post(superAdmin, "/v1/admin/packaging/GB", { code: "box-t", label: "Medium box", kind: "BOX", lengthMm: 400, widthMm: 300, heightMm: 200 }).expect(201)).body.id;
    const token = (path: RegExp) => path.exec(test.email.lastTo(SHOPPER)!.text)![1]!;
    const lines = [
      { url: "https://shop.example/trainers", description: "White trainers, size 6", quantity: 1 },
      { url: "https://shop.example/scarf", description: "Green wool scarf", quantity: 1 },
    ];
    await test.http().post("/v1/public/shopping").send({ countryCode: "GB", buyerEmail: SHOPPER, buyerName: "Ada Obi", shipTo: SHIP_TO, lines }).expect(201);
    await test
      .http()
      .post("/v1/public/shopping/confirm")
      .set("Origin", WEB_ORIGIN)
      .send({ token: token(/\/shopping\/confirm#token=([A-Za-z0-9_-]{43})/) })
      .expect(200);
    await test.http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email: SHOPPER }).expect(202);
    const session = await test
      .http()
      .post("/v1/buyer/auth/session")
      .set("Origin", WEB_ORIGIN)
      .send({ token: token(/#token=([A-Za-z0-9_-]{43})/) })
      .expect(200);
    const cookie = ([] as string[])
      .concat(session.headers["set-cookie"] ?? [])
      .find((value) => value.startsWith("gfn_bs="))!
      .split(";")[0]!;
    const request = ((await test.http().get("/v1/buyer/shopping").set("Cookie", cookie).expect(200)).body as ShoppingRequestView[])[0]!;
    const quoteLines = request.lines.map((line) => ({ lineId: line.id, available: true, unitPriceMinor: 2_000, unitWeightGrams: 300 }));
    await post(ops, `/v1/admin/shopping/${request.id}/quote`, { warehouseId, packagingPresetId: boxId, lines: quoteLines }).expect(200);
    await test.http().post(`/v1/buyer/shopping/${request.id}/checkout`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ deliverySpeed: "STANDARD" }).expect(200);
    await test.http().post(`/v1/buyer/shopping/by-reference/${request.reference}/sandbox-payment`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).expect(204);
    await post(ops, `/v1/admin/shopping/${request.id}/purchase`, { lines: request.lines.map((line) => ({ lineId: line.id, bought: true })) }).expect(200);
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    await post(operator, `/v1/warehouse/shopping/${request.id}/arrival`, { lines: request.lines.map((line) => ({ lineId: line.id, receivedQuantity: 1 })), photoFileIds: [photo] }).expect(200);
    await post(operator, `/v1/warehouse/shopping/${request.id}/ship`).expect(200);
    await post(operator, `/v1/warehouse/shopping/${request.id}/delivered`).expect(200);
    expect(kinds(SHOPPER, /^(shopping|buyer)\./)).toEqual([
      "shopping.confirm_request",
      "shopping.received",
      "buyer.sign_in_link",
      "shopping.quote_ready",
      "shopping.paid",
      "shopping.items_bought",
      "shopping.shipped",
      "shopping.delivered",
    ]);
    expect(test.email.sent.find((message) => message.kind === "shopping.quote_ready" && message.to === SHOPPER)!.action).toEqual({ label: "See your price", url: `${WEB}/account?tab=shopping` });
  });

  it("emails signed-in and anonymous reporters when their support case is resolved", async () => {
    const admin = await createStaff(test, "admin@trail.test", "ADMIN");
    const report = (contactEmail?: string) => ({
      kind: "ERROR",
      page: "/inbound/new",
      message: "",
      error: { code: "internal_error", status: 500, endpoint: "/v1/inbound", correlationId: "c0ffee00-0000-4000-8000-000000000000" },
      trail: [{ at: new Date().toISOString(), what: "Opened Declare a shipment" }],
      ...(contactEmail ? { contactEmail } : {}),
    });
    const opened = (await test.http().post("/v1/support-cases").set(as(owner)).send(report()).expect(201)).body as { reference: string };
    await test.http().post("/v1/public/support-cases").send(report("visitor@trail.example")).expect(201);
    expect(test.email.lastTo("help@gfn.test")!.kind).toBe("support.new_case");
    const [supportCase] = await query<{ id: string }>("SELECT id FROM support_cases WHERE reference = $1", [opened.reference]);
    await post(admin, `/v1/admin/support-cases/${supportCase!.id}/resolve`, { note: "We fixed the form." }).expect(200);
    for (const reporter of [OWNER, "visitor@trail.example"]) {
      const resolved = test.email.lastTo(reporter)!;
      expect(resolved.kind).toBe("support.case_resolved");
      expect(resolved.text).toContain("We fixed the form.");
      expect(resolved.action).toEqual({ label: "Try again", url: `${WEB}/inbound/new` });
    }
  });
});
