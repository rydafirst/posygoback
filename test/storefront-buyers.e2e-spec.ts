import { StorefrontOrdersService } from "../src/modules/commerce/orders/storefront-orders.service";
import { StorefrontPayoutsService } from "../src/modules/commerce/orders/storefront-payouts.service";
import { StorefrontRefundsService } from "../src/modules/commerce/orders/storefront-refunds.service";
import { SYSTEM_ACTOR } from "../src/infrastructure/audit/audit.service";
import { PaymentEventsService } from "../src/modules/finance/payments/payment-events.service";
import type { BuyerView, DiscountCodeView, QuoteView, StoreReturnCaseView, StorefrontOrderView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, signUpAndVerify, startApp, type TestApp, WEB_ORIGIN } from "./harness";
import { as, query } from "./partner-helpers";
import { handOff, type OpenStore, openStore, paidOrder, SHIP_TO } from "./store-helpers";

const BUYER = "chioma@buyer.example";

describe("buyers, discount codes and store returns", () => {
  let test: TestApp;
  let store: OpenStore;
  let otherOwner: string;
  let finance: string;
  let countryOps: string;
  let buyerCookie: string;
  let order: { id: string; reference: string };

  const http = () => test.http();
  const linkToken = (email: string) => /#token=([A-Za-z0-9_-]{43})/.exec(test.email.lastTo(email)!.text)![1]!;
  const signInBuyer = async (email: string) => {
    await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email }).expect(202);
    const response = await http()
      .post("/v1/buyer/auth/session")
      .set("Origin", WEB_ORIGIN)
      .send({ token: linkToken(email) })
      .expect(200);
    const cookies = ([] as string[]).concat(response.headers["set-cookie"] ?? []);
    return cookies.find((cookie) => cookie.startsWith("gfn_bs="))!.split(";")[0]!;
  };
  const deliver = (orderId: string) => handOff(test, orderId);
  const askReturn = (orderId: string, cookie = buyerCookie) =>
    http().post(`/v1/buyer/orders/${orderId}/returns`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ reason: "The colour is darker than the photo." });

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    store = await openStore(test, "ada");
    otherOwner = (await signUpAndVerify(test, "other@store.example")).accessToken;
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    countryOps = await createStaff(test, "ops@gfn.test", "COUNTRY_OPS", "GB");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("discount codes", () => {
    it("lets the owner create and switch off a code that buyers can use at checkout", async () => {
      const code = { code: "welcome10", kind: "PERCENT", percentBps: 1_000 };
      const created = (await http().post("/v1/vendor/storefront/discounts").set(as(store.owner)).send(code).expect(201)).body as DiscountCodeView;
      expect(created).toMatchObject({ code: "WELCOME10", percentBps: 1_000, redemptions: 0, active: true });
      expect((await http().post("/v1/vendor/storefront/discounts").set(as(store.owner)).send(code).expect(400)).body.fieldErrors.code[0]).toMatch(/already have/);
      await http().post("/v1/vendor/storefront/discounts").set(as(store.owner)).send({ code: "BAD", kind: "PERCENT", amountMinor: 500 }).expect(400);
      await http().put(`/v1/vendor/storefront/discounts/${created.id}`).set(as(otherOwner)).send({ active: false }).expect(404);
      await http().get("/v1/vendor/storefront/discounts").set(as(finance)).expect(404);
      const quote = async () =>
        (
          await http()
            .post(`/v1/public/stores/${store.slug}/quote`)
            .send({ items: [{ productId: store.productId, quantity: 1 }], shipTo: SHIP_TO, discountCode: "welcome10" })
            .expect(200)
        ).body as QuoteView;
      expect(await quote()).toMatchObject({ discountMinor: 600, discountProblem: null });
      await http().put(`/v1/vendor/storefront/discounts/${created.id}`).set(as(store.owner)).send({ active: false }).expect(200);
      expect(await quote()).toMatchObject({ discountMinor: 0, discountProblem: expect.stringMatching(/isn't valid/) });
    });
  });

  describe("buyer sign-in", () => {
    it("emails a one-time link only to people who have bought, and starts a session from it", async () => {
      order = await paidOrder(test, store, BUYER);
      await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email: "stranger@buyer.example" }).expect(202);
      expect(test.email.lastTo("stranger@buyer.example")).toBeUndefined();
      await http().post("/v1/buyer/auth/link").send({ email: BUYER }).expect(403);
      await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email: BUYER }).expect(202);
      const token = linkToken(BUYER);
      await http().post("/v1/buyer/auth/session").send({ token }).expect(403);
      const started = await http().post("/v1/buyer/auth/session").set("Origin", WEB_ORIGIN).send({ token }).expect(200);
      expect(started.body as BuyerView).toEqual({ email: BUYER, name: "Chioma Eze" });
      const cookie = ([] as string[]).concat(started.headers["set-cookie"] ?? []).find((value) => value.startsWith("gfn_bs="))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/v1\/buyer/);
      await http().post("/v1/buyer/auth/session").set("Origin", WEB_ORIGIN).send({ token }).expect(401);
      buyerCookie = cookie.split(";")[0]!;
    });

    it("shows a buyer only their own orders, and nothing without a session", async () => {
      const orders = (await http().get("/v1/buyer/orders").set("Cookie", buyerCookie).expect(200)).body as StorefrontOrderView[];
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ reference: order.reference, vendorShareMinor: null, payoutStatus: null, canRequestReturn: false, returns: [] });
      await http().get("/v1/buyer/orders").expect(401);
      await http()
        .get("/v1/buyer/orders")
        .set("Cookie", `gfn_bs=${"x".repeat(43)}`)
        .expect(401);
      await paidOrder(test, store, "someone@buyer.example");
      const someone = await signInBuyer("someone@buyer.example");
      await http().get(`/v1/buyer/orders/${order.id}`).set("Cookie", someone).expect(404);
      await http().post("/v1/buyer/auth/sign-out").set("Origin", WEB_ORIGIN).set("Cookie", someone).expect(204);
      await http().get("/v1/buyer/orders").set("Cookie", someone).expect(401);
    });
  });

  describe("returns", () => {
    it("opens a return only after the order is sent, once, and holds the payout while it's open", async () => {
      expect((await askReturn(order.id).expect(409)).body.message).toMatch(/can't be returned/);
      await deliver(order.id);
      const asked = (await askReturn(order.id).expect(201)).body as StorefrontOrderView;
      expect(asked).toMatchObject({ canRequestReturn: false, returns: [{ status: "REQUESTED", reason: "The colour is darker than the photo." }] });
      expect(test.email.lastTo("ada@store.example")!.subject).toBe(`Return requested for store order ${order.reference}`);
      await askReturn(order.id).expect(409);
      await http().post(`/v1/buyer/orders/${order.id}/returns`).set("Cookie", buyerCookie).send({ reason: "No origin header here." }).expect(403);
      await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [order.id]);
      expect(await test.app.get(StorefrontPayoutsService).releaseDue()).toBe(0);
    });

    it("lets the vendor accept with a partial refund, then pays out what is left", async () => {
      const [open] = (await http().get("/v1/vendor/storefront/returns?status=REQUESTED").set(as(store.owner)).expect(200)).body as StoreReturnCaseView[];
      expect(open!.order).toMatchObject({ reference: order.reference, buyerEmail: null });
      await http().post(`/v1/vendor/storefront/returns/${open!.id}/decision`).set(as(otherOwner)).send({ accept: false, note: "Not mine" }).expect(404);
      await http().post(`/v1/vendor/storefront/returns/${open!.id}/decision`).set(as(store.owner)).send({ accept: true, note: "Sorry about that" }).expect(400);
      const total = open!.order.totalMinor;
      await http()
        .post(`/v1/vendor/storefront/returns/${open!.id}/decision`)
        .set(as(store.owner))
        .send({ accept: true, refundMinor: total + 1, note: "Sorry about that" })
        .expect(400);
      const decided = (
        await http().post(`/v1/vendor/storefront/returns/${open!.id}/decision`).set(as(store.owner)).send({ accept: true, refundMinor: 3_000, note: "Keep it, sorry about that." }).expect(200)
      ).body as StoreReturnCaseView;
      expect(decided).toMatchObject({ status: "REFUNDED", refundMinor: 3_000, order: { refundedMinor: 3_000, status: "SHIPPED" } });
      expect(test.email.lastTo(BUYER)!.subject).toMatch(/refund for order/);
      await http().post(`/v1/vendor/storefront/returns/${open!.id}/decision`).set(as(store.owner)).send({ accept: false, note: "Changed my mind" }).expect(409);
      expect(await test.app.get(StorefrontPayoutsService).releaseDue()).toBe(1);
      const [paid] = await query<{ payout_status: string }>("SELECT payout_status FROM storefront_orders WHERE id = $1", [order.id]);
      expect(paid!.payout_status).toBe("PAID");
      expect(test.email.lastTo("ada@store.example")!.subject).toBe(`£30.00 on its way for store order ${order.reference}`);
    });

    it("lets finance step in to turn down a return; country ops can only look", async () => {
      const second = await paidOrder(test, store, BUYER);
      await deliver(second.id);
      await askReturn(second.id).expect(201);
      const [open] = (await http().get("/v1/admin/storefront-returns?status=REQUESTED").set(as(countryOps)).expect(200)).body as StoreReturnCaseView[];
      expect(open!.order.buyerEmail).toBe(BUYER);
      await http().post(`/v1/admin/storefront-returns/${open!.id}/decision`).set(as(countryOps)).send({ accept: false, note: "Worn" }).expect(404);
      const rejected = (await http().post(`/v1/admin/storefront-returns/${open!.id}/decision`).set(as(finance)).send({ accept: false, note: "The item was worn." }).expect(200))
        .body as StoreReturnCaseView;
      expect(rejected).toMatchObject({ status: "REJECTED", decisionNote: "The item was worn." });
      expect(test.email.lastTo(BUYER)!.text).toContain("The item was worn.");
    });

    it("refuses a return once the window has closed", async () => {
      const late = await paidOrder(test, store, BUYER);
      await deliver(late.id);
      await query("UPDATE storefront_orders SET paid_at = paid_at - interval '40 days', shipped_at = shipped_at - interval '40 days', returns_until = shipped_at - interval '10 days' WHERE id = $1", [
        late.id,
      ]);
      expect((await askReturn(late.id).expect(409)).body.message).toMatch(/window/);
    });
  });

  describe("money safety", () => {
    const row = async (id: string) =>
      (await query<{ refunded_minor: string; payout_status: string; status: string }>("SELECT refunded_minor, payout_status, status FROM storefront_orders WHERE id = $1", [id]))[0]!;
    const event = (payload: Record<string, unknown>) => test.app.get(PaymentEventsService).handle("SANDBOX", "GB", { type: "test", payload: {}, ...payload } as never);

    it("counts a refund once, whether it is retried or Stripe reports it as well", async () => {
      const paid = await paidOrder(test, store, "twice@buyer.example");
      const refunds = test.app.get(StorefrontRefundsService);
      await refunds.refund(paid.id, 1_000, `test:${paid.id}`, SYSTEM_ACTOR, "Scuffed box");
      await refunds.refund(paid.id, 1_000, `test:${paid.id}`, SYSTEM_ACTOR, "Scuffed box");
      expect(Number((await row(paid.id)).refunded_minor)).toBe(1_000);
      await event({ kind: "PAYMENT_REFUNDED", eventId: `refund-${paid.id}`, paymentId: `sandbox_payment_${paid.id}`, refundedTotalMinor: 1_000, currency: "GBP" });
      expect(Number((await row(paid.id)).refunded_minor)).toBe(1_000);
      expect(await query("SELECT id FROM storefront_refunds WHERE storefront_order_id = $1", [paid.id])).toHaveLength(1);
    });

    it("pays the vendor only after the parcel leaves, and not while a dispute is open", async () => {
      const paid = await paidOrder(test, store, "dispute@buyer.example");
      await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [paid.id]);
      await test.app.get(StorefrontPayoutsService).releaseDue();
      expect((await row(paid.id)).payout_status).toBe("HELD");
      await handOff(test, paid.id);
      await event({ kind: "PAYMENT_DISPUTED", eventId: `dispute-open-${paid.id}`, paymentId: `sandbox_payment_${paid.id}`, amountMinor: 100, currency: "GBP", stage: "OPENED" });
      await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [paid.id]);
      await test.app.get(StorefrontPayoutsService).releaseDue();
      expect((await row(paid.id)).payout_status).toBe("HELD");
      await event({ kind: "PAYMENT_DISPUTED", eventId: `dispute-won-${paid.id}`, paymentId: `sandbox_payment_${paid.id}`, amountMinor: 100, currency: "GBP", stage: "WON" });
      await test.app.get(StorefrontPayoutsService).releaseDue();
      expect((await row(paid.id)).payout_status).toBe("PAID");
    });

    it("gives back a second payment for an order that was already paid", async () => {
      const paid = await paidOrder(test, store, "double@buyer.example");
      const [order] = await query<{ provider_reference: string; total_minor: string }>("SELECT provider_reference, total_minor FROM storefront_orders WHERE id = $1", [paid.id]);
      const outcome = await event({
        kind: "ORDER_PAID",
        orderKind: "STORE",
        eventId: `second-${paid.id}`,
        orderId: paid.id,
        providerReference: order!.provider_reference,
        paymentId: "another-payment",
        amountMinor: Number(order!.total_minor),
        currency: "GBP",
      });
      expect(outcome).toBe("rejected: paid twice");
    });

    it("keeps vendor-approved refunds within the vendor's share; finance can go further", async () => {
      const paid = await paidOrder(test, store, BUYER);
      await deliver(paid.id);
      await askReturn(paid.id).expect(201);
      const [open] = (await http().get("/v1/vendor/storefront/returns?status=REQUESTED").set(as(store.owner)).expect(200)).body as StoreReturnCaseView[];
      const total = open!.order.totalMinor;
      expect(total).toBeGreaterThan(open!.order.vendorShareMinor!);
      const tooMuch = await http().post(`/v1/vendor/storefront/returns/${open!.id}/decision`).set(as(store.owner)).send({ accept: true, refundMinor: total, note: "Full refund" }).expect(400);
      expect(tooMuch.body.fieldErrors.refundMinor[0]).toMatch(/your share/);
      const done = (await http().post(`/v1/admin/storefront-returns/${open!.id}/decision`).set(as(finance)).send({ accept: true, refundMinor: total, note: "Full refund" }).expect(200))
        .body as StoreReturnCaseView;
      expect(done).toMatchObject({ status: "REFUNDED", order: { status: "REFUNDED", payoutStatus: "CANCELLED" } });
    });

    it("reserves a limited discount code at checkout and frees it if the checkout lapses", async () => {
      await http().post("/v1/vendor/storefront/discounts").set(as(store.owner)).send({ code: "ONEONLY", kind: "FIXED", amountMinor: 500, maxRedemptions: 1 }).expect(201);
      const start = (email: string) =>
        http()
          .post(`/v1/public/stores/${store.slug}/checkout`)
          .send({ items: [{ productId: store.productId, quantity: 1 }], shipTo: SHIP_TO, buyerEmail: email, buyerName: "Chioma Eze", deliverySpeed: "STANDARD", discountCode: "ONEONLY" });
      await start("first@buyer.example").expect(200);
      expect((await start("second@buyer.example").expect(400)).body.fieldErrors.discountCode[0]).toMatch(/used up/);
      await test.app.get(StorefrontOrdersService).expireUnpaid(new Date(Date.now() + 3_600_000));
      await start("second@buyer.example").expect(200);
    });

    it("shows little on the public receipt link and hides the buyer's address from the vendor's warehouse order", async () => {
      const paid = await paidOrder(test, store, "private@buyer.example");
      const receipt = (await http().get(`/v1/public/storefront-orders/${paid.id}`).expect(200)).body as StorefrontOrderView;
      expect(receipt).toMatchObject({ buyerEmail: null, buyerName: "", recipientCity: "", vendorShareMinor: null, returns: [] });
      const [link] = await query<{ fulfilment_order_id: string }>("SELECT fulfilment_order_id FROM storefront_orders WHERE id = $1", [paid.id]);
      const detail = (await http().get(`/v1/vendor/orders/${link!.fulfilment_order_id}`).set(as(store.owner)).expect(200)).body as { recipient: Record<string, unknown> };
      expect(detail.recipient).toMatchObject({ line1: "Hidden" });
      expect(detail.recipient.email).toBeUndefined();
      expect(JSON.stringify(detail)).not.toContain("private@buyer.example");
    });
  });
});
