import { ShoppingQuotesService } from "../src/modules/commerce/shopping/shopping-quotes.service";
import { ShoppingRefundsService } from "../src/modules/commerce/shopping/shopping-refunds.service";
import { ShoppingRequestsService } from "../src/modules/commerce/shopping/shopping-requests.service";
import { PaymentAccountsService } from "../src/modules/finance/payments/payment-accounts.service";
import { PaymentEventsService } from "../src/modules/finance/payments/payment-events.service";
import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import type { ShoppingRequestView, ShoppingStartedView } from "../src/shared";
import { createStaff, flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile, WEB_ORIGIN } from "./harness";
import { as } from "./partner-helpers";
import { SHIP_TO } from "./store-helpers";

const BUYER = "ada@shopper.example";
const ITEMS = [
  { url: "https://shop.example/trainers", description: "White trainers, size 6", quantity: 2 },
  { url: "https://shop.example/scarf", description: "Green wool scarf", quantity: 1 },
  { url: "https://shop.example/lamp", description: "Brass desk lamp", quantity: 1 },
];

describe("personal shopping", () => {
  let test: TestApp;
  let superAdmin: string;
  let ops: string;
  let usOps: string;
  let finance: string;
  let operator: string;
  let vendor: string;
  let warehouseId: string;
  let boxId: string;
  let buyer = "";
  let request: ShoppingRequestView;

  const http = () => test.http();
  const linkToken = (email: string) => /#token=([A-Za-z0-9_-]{43})/.exec(test.email.lastTo(email)!.text)![1]!;
  const signInBuyer = async (email: string) => {
    await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email }).expect(202);
    const response = await http()
      .post("/v1/buyer/auth/session")
      .set("Origin", WEB_ORIGIN)
      .send({ token: linkToken(email) })
      .expect(200);
    return ([] as string[])
      .concat(response.headers["set-cookie"] ?? [])
      .find((cookie) => cookie.startsWith("gfn_bs="))!
      .split(";")[0]!;
  };
  const ask = (email: string, extra: Record<string, unknown> = {}) =>
    http()
      .post("/v1/public/shopping")
      .send({ countryCode: "GB", buyerEmail: email, buyerName: "Ada Obi", shipTo: SHIP_TO, lines: ITEMS, ...extra });
  const confirmToken = (email: string) => /\/shopping\/confirm#token=([A-Za-z0-9_-]{43})/.exec(test.email.lastTo(email)!.text)![1]!;
  const submit = async (email: string) => {
    await ask(email).expect(201);
    return http()
      .post("/v1/public/shopping/confirm")
      .set("Origin", WEB_ORIGIN)
      .send({ token: confirmToken(email) })
      .expect(200);
  };
  const event = (body: Record<string, unknown>) => test.app.get(PaymentEventsService).handle("SANDBOX", "GB", { type: "test", payload: {}, currency: "GBP", ...body } as never);
  const mine = async (cookie: string) => (await http().get("/v1/buyer/shopping").set("Cookie", cookie).expect(200)).body as ShoppingRequestView[];
  const priceAll = (target: ShoppingRequestView, token = ops) =>
    http()
      .post(`/v1/admin/shopping/${target.id}/quote`)
      .set(as(token))
      .send({
        warehouseId,
        packagingPresetId: boxId,
        lines: [
          { lineId: target.lines[0]!.id, available: true, unitPriceMinor: 4_000, unitWeightGrams: 800 },
          { lineId: target.lines[1]!.id, available: true, unitPriceMinor: 2_000, unitWeightGrams: 200 },
          { lineId: target.lines[2]!.id, available: false, staffNote: "Discontinued" },
        ],
      });
  const pay = async (target: ShoppingRequestView, cookie = buyer) => {
    const started = (await http().post(`/v1/buyer/shopping/${target.id}/checkout`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ deliverySpeed: "STANDARD" }).expect(200))
      .body as ShoppingStartedView;
    await http().post(`/v1/buyer/shopping/by-reference/${target.reference}/sandbox-payment`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).expect(204);
    return started;
  };
  const staffView = async (id: string) => (await http().get(`/v1/admin/shopping/${id}`).set(as(ops)).expect(200)).body as ShoppingRequestView;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    ops = await createStaff(test, "ops@gfn.test", "COUNTRY_OPS", "GB");
    usOps = await createStaff(test, "us-ops@gfn.test", "COUNTRY_OPS", "US");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    operator = await createStaff(test, "operator@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    vendor = (await signUpAndVerify(test, "seller@shop.example")).accessToken;
    warehouseId = (
      await http()
        .post("/v1/warehouse/warehouses")
        .set(as(superAdmin))
        .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4"], city: "Manchester", postalCode: "M17 1AA" })
        .expect(201)
    ).body.id;
    boxId = (await http().post("/v1/admin/packaging/GB").set(as(superAdmin)).send({ code: "box-m", label: "Medium box", kind: "BOX", lengthMm: 400, widthMm: 300, heightMm: 200 }).expect(201)).body.id;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("takes a request from anyone, but only for real links and places we deliver to", async () => {
    const destinations = (await http().get("/v1/public/shopping/destinations/GB").expect(200)).body as Array<{ code: string }>;
    expect(destinations.map((entry) => entry.code).sort()).toEqual(["GB", "US"]);
    await http().get("/v1/public/shopping/destinations/ZZ").expect(404);
    await http().get("/v1/public/shopping/destinations/gb").expect(400);
    expect((await ask(BUYER, { lines: [{ ...ITEMS[0], url: "http://shop.example/x" }] }).expect(400)).body.fieldErrors["lines.0.url"]).toBeDefined();
    await ask(BUYER, { shipTo: { ...SHIP_TO, countryCode: "FR" } }).expect(400);
    await ask(BUYER, { countryCode: "ZZ" }).expect(400);
    const created = (await ask(BUYER).expect(201)).body as { reference: string };
    expect(created.reference).toMatch(/^SHP-GB-[A-Z0-9]{8}$/);
    const email = test.email.lastTo(BUYER)!;
    expect(email.subject).toBe(`Confirm your shopping request ${created.reference}`);
    expect(email.text).toContain("Chioma Eze, Manchester M3 4LQ, GB");
    expect(((await http().get("/v1/admin/shopping").set(as(ops)).expect(200)).body as ShoppingRequestView[]).map((row) => row.reference)).not.toContain(created.reference);
    const token = confirmToken(BUYER);
    await http().post("/v1/public/shopping/confirm").send({ token }).expect(403);
    await http()
      .post("/v1/public/shopping/confirm")
      .set("Origin", WEB_ORIGIN)
      .send({ token: "x".repeat(43) })
      .expect(404);
    expect((await http().post("/v1/public/shopping/confirm").set("Origin", WEB_ORIGIN).send({ token }).expect(200)).body).toEqual({ reference: created.reference });
    await http().post("/v1/public/shopping/confirm").set("Origin", WEB_ORIGIN).send({ token }).expect(404);
    expect(test.email.lastTo(BUYER)!.subject).toBe(`We've got your shopping request ${created.reference}`);
  });

  it("drops requests nobody confirms, so a stranger can't use someone else's email", async () => {
    await ask("victim@shopper.example", { shipTo: { ...SHIP_TO, name: "Someone Else" } }).expect(201);
    const victim = await signInBuyer("victim@shopper.example");
    expect(await mine(victim)).toEqual([]);
    expect(await test.app.get(ShoppingRequestsService).expireUnconfirmed(new Date(Date.now() + 49 * 60 * 60 * 1000))).toBe(1);
  });

  it("shows the request, with the full delivery address, only to the buyer who made it", async () => {
    await http().get("/v1/buyer/shopping").expect(401);
    buyer = await signInBuyer(BUYER);
    request = (await mine(buyer))[0]!;
    expect(request).toMatchObject({ status: "REQUESTED", totalMinor: 0, confirmed: true, shipTo: { name: "Chioma Eze", line1: "8 Deansgate", postalCode: "M3 4LQ" } });
    await submit("stranger@shopper.example");
    const stranger = await signInBuyer("stranger@shopper.example");
    expect((await mine(stranger)).map((row) => row.id)).not.toContain(request.id);
    await http().get(`/v1/buyer/shopping/${request.id}`).set("Cookie", stranger).expect(404);
    await http().post(`/v1/buyer/shopping/${request.id}/cancel`).set("Origin", WEB_ORIGIN).set("Cookie", stranger).expect(404);
  });

  it("lets country staff price it, and keeps everyone else out", async () => {
    await http().get("/v1/admin/shopping").expect(401);
    await http().get("/v1/admin/shopping").set(as(vendor)).expect(404);
    await http().get(`/v1/admin/shopping/${request.id}`).set(as(usOps)).expect(404);
    expect(((await http().get("/v1/admin/shopping").set(as(finance)).expect(200)).body as ShoppingRequestView[]).map((row) => row.id)).toContain(request.id);
    await priceAll(request, finance).expect(404);
    await priceAll(request, usOps).expect(404);
    await http()
      .post(`/v1/admin/shopping/${request.id}/quote`)
      .set(as(ops))
      .send({ warehouseId, packagingPresetId: boxId, lines: [{ lineId: request.lines[0]!.id, available: true, unitPriceMinor: 4_000, unitWeightGrams: 800 }] })
      .expect(400);
    const quoted = (await priceAll(request).expect(200)).body as ShoppingRequestView;
    expect(quoted).toMatchObject({ status: "QUOTED", goodsMinor: 10_000, commissionMinor: 1_500, warehouseName: "Manchester" });
    expect(quoted.totalMinor).toBe(10_000 + 1_500 + quoted.deliveryMinor);
    expect(quoted.lines.map((line) => line.status)).toEqual(["QUOTED", "QUOTED", "UNAVAILABLE"]);
    expect(test.email.lastTo(BUYER)!.subject).toMatch(/^Your price for SHP-GB-/);
    const seen = (await mine(buyer))[0]!;
    expect(seen.lines[0]).toMatchObject({ unitPriceMinor: 4_000, unitWeightGrams: null, hsCode: null });
    expect(seen.deliveryOptions[0]!.speed).toBe("STANDARD");
  });

  it("takes payment once, from the buyer, at the quoted amount", async () => {
    await http().post(`/v1/buyer/shopping/${request.id}/checkout`).set("Cookie", buyer).send({ deliverySpeed: "STANDARD" }).expect(403);
    const started = await pay(request);
    expect(started.redirectUrl).toContain("/shopping/sandbox?order=");
    request = await staffView(request.id);
    expect(request.status).toBe("PAID");
    expect(test.email.lastTo(BUYER)!.subject).toBe(`Paid: ${request.reference}`);
    await http().post(`/v1/buyer/shopping/by-reference/${request.reference}/sandbox-payment`).set("Origin", WEB_ORIGIN).set("Cookie", buyer).expect(204);
    expect((await staffView(request.id)).status).toBe("PAID");
    await http().post(`/v1/buyer/shopping/${request.id}/cancel`).set("Origin", WEB_ORIGIN).set("Cookie", buyer).expect(409);
  });

  it("refunds a stray payment that doesn't match the request", async () => {
    const processor = test.app.get(PaymentAccountsService).forCountry("GB").processor;
    const refund = jest.spyOn(processor, "refund");
    const outcome = await test.app
      .get(PaymentEventsService)
      .handle("SANDBOX", "GB", {
        kind: "ORDER_PAID",
        orderKind: "SHOPPING",
        eventId: "stray-1",
        orderId: request.id,
        providerReference: `sandbox_${request.id}`,
        paymentId: "stray-payment",
        amountMinor: 1,
        currency: "GBP",
        type: "test",
        payload: {},
      });
    expect(outcome).toMatch(/^rejected/);
    expect(refund).toHaveBeenCalledWith({ paymentId: "stray-payment", amountMinor: 1, idempotencyKey: "shopping-stray:stray-payment" });
    refund.mockRestore();
    expect((await staffView(request.id)).status).toBe("PAID");
  });

  it("refunds what couldn't be bought, with its share of our fee", async () => {
    const bought = (
      await http()
        .post(`/v1/admin/shopping/${request.id}/purchase`)
        .set(as(ops))
        .send({
          lines: [
            { lineId: request.lines[0]!.id, bought: true, retailerOrderRef: "R-123" },
            { lineId: request.lines[1]!.id, bought: false },
          ],
        })
        .expect(200)
    ).body as ShoppingRequestView;
    expect(bought).toMatchObject({ status: "BUYING", refundedMinor: 2_000 + 300 });
    expect(test.email.lastTo(BUYER)!.subject).toBe(`${request.reference}: some items were out of stock`);
    await http()
      .post(`/v1/admin/shopping/${request.id}/purchase`)
      .set(as(ops))
      .send({ lines: [{ lineId: request.lines[1]!.id, bought: true }] })
      .expect(409);
  });

  it("lets the warehouse book the items in with photos, refund anything short, and send them once", async () => {
    await http().get("/v1/warehouse/shopping").set(as(vendor)).expect(404);
    const desk = (await http().get("/v1/warehouse/shopping").set(as(operator)).expect(200)).body as ShoppingRequestView[];
    expect(desk.find((row) => row.id === request.id)).toMatchObject({ buyerEmail: null, shipTo: null, notes: null });
    expect(desk.find((row) => row.id === request.id)!.lines[0]!.retailerOrderRef).toBeNull();
    await http().post(`/v1/warehouse/shopping/${request.id}/ship`).set(as(operator)).expect(409);
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    const arrival = (count: number) => ({ lines: [{ lineId: request.lines[0]!.id, receivedQuantity: count }], photoFileIds: [photo] });
    await http().post(`/v1/warehouse/shopping/${request.id}/arrival`).set(as(operator)).send(arrival(3)).expect(400);
    await http()
      .post(`/v1/warehouse/shopping/${request.id}/arrival`)
      .set(as(operator))
      .send({ lines: arrival(1).lines, photoFileIds: [] })
      .expect(400);
    expect(((await http().post(`/v1/warehouse/shopping/${request.id}/arrival`).set(as(operator)).send(arrival(1)).expect(200)).body as ShoppingRequestView).status).toBe("ARRIVED");
    expect((await staffView(request.id)).refundedMinor).toBe(2_300 + 4_000 + 600);
    expect(test.email.lastTo(BUYER)!.subject).toBe(`${request.reference}: some items were out of stock`);
    await http().post(`/v1/admin/shopping/${request.id}/cancel`).set(as(ops)).send({ reason: "Changed our mind" }).expect(409);
    expect((await staffView(request.id)).arrivalPhotoFileIds).toEqual([photo]);
    expect((await http().get(`/v1/admin/shopping/${request.id}/photos/${photo}`).set(as(ops)).expect(200)).body.url).toBeTruthy();
    await http().get(`/v1/admin/shopping/${request.id}/photos/${photo}`).set(as(usOps)).expect(404);
    expect((await mine(buyer)).find((row) => row.id === request.id)!.arrivalPhotoFileIds).toEqual([]);
    const both = await Promise.all([1, 2].map(() => http().post(`/v1/warehouse/shopping/${request.id}/ship`).set(as(operator))));
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);
    const shipped = both.find((response) => response.status === 200)!.body as ShoppingRequestView;
    expect(shipped).toMatchObject({ status: "SHIPPED" });
    expect(shipped.trackingNumber).toBeTruthy();
    expect(test.email.lastTo(BUYER)!.subject).toBe(`${request.reference} is on its way`);
    expect(((await http().post(`/v1/warehouse/shopping/${request.id}/delivered`).set(as(operator)).expect(200)).body as ShoppingRequestView).status).toBe("DELIVERED");
  });

  it("holds a disputed request, and stops it if the card provider gives the money back", async () => {
    await submit(BUYER);
    const disputed = (await mine(buyer))[0]!;
    await priceAll(disputed).expect(200);
    await pay(disputed);
    const paymentId = `sandbox_payment_${disputed.id}`;
    await event({ kind: "PAYMENT_DISPUTED", eventId: `open-${disputed.id}`, paymentId, amountMinor: 100, stage: "OPENED" });
    expect((await staffView(disputed.id)).disputeOpen).toBe(true);
    const buyAll = { lines: [{ lineId: disputed.lines[0]!.id, bought: true }] };
    await http().post(`/v1/admin/shopping/${disputed.id}/purchase`).set(as(ops)).send(buyAll).expect(409);
    await event({ kind: "PAYMENT_DISPUTED", eventId: `won-${disputed.id}`, paymentId, amountMinor: 100, stage: "WON" });
    await http().post(`/v1/admin/shopping/${disputed.id}/purchase`).set(as(ops)).send(buyAll).expect(200);
    const total = (await staffView(disputed.id)).totalMinor;
    await event({ kind: "PAYMENT_REFUNDED", eventId: `refunded-${disputed.id}`, paymentId, refundedTotalMinor: total });
    expect(await staffView(disputed.id)).toMatchObject({ status: "CANCELLED", refundedMinor: total });
  });

  it("keeps a refund the provider refused and sends it on the next try", async () => {
    await submit(BUYER);
    const failing = (await mine(buyer))[0]!;
    await priceAll(failing).expect(200);
    await pay(failing);
    const processor = test.app.get(PaymentAccountsService).forCountry("GB").processor;
    const refund = jest.spyOn(processor, "refund").mockRejectedValueOnce(new Error("provider down"));
    const cancelled = (await http().post(`/v1/admin/shopping/${failing.id}/cancel`).set(as(ops)).send({ reason: "The shop closed down." }).expect(200)).body as ShoppingRequestView;
    expect(cancelled).toMatchObject({ status: "CANCELLED", refundedMinor: 0 });
    expect(await test.app.get(ShoppingRefundsService).retryStale()).toBe(1);
    expect((await staffView(failing.id)).refundedMinor).toBe(cancelled.totalMinor);
    expect(refund).toHaveBeenCalledTimes(2);
    expect(refund.mock.calls[0]![0].idempotencyKey).toBe(refund.mock.calls[1]![0].idempotencyKey);
    refund.mockRestore();
    expect(await test.app.get(ShoppingRefundsService).retryStale()).toBe(0);
  });

  it("refunds everything left when staff cancel a paid request", async () => {
    await submit(BUYER);
    const second = (await mine(buyer))[0]!;
    await priceAll(second).expect(200);
    await pay(second);
    const cancelled = (await http().post(`/v1/admin/shopping/${second.id}/cancel`).set(as(ops)).send({ reason: "The shop won't post to our warehouse." }).expect(200)).body as ShoppingRequestView;
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.refundedMinor).toBe(cancelled.totalMinor);
    expect(test.email.lastTo(BUYER)!.text).toContain("We've refunded");
  });

  it("lets a price run out and be given again, and the buyer cancel before paying", async () => {
    await submit(BUYER);
    const third = (await mine(buyer))[0]!;
    await priceAll(third).expect(200);
    expect(await test.app.get(ShoppingQuotesService).expireDue(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toBe(1);
    await http().post(`/v1/buyer/shopping/${third.id}/checkout`).set("Origin", WEB_ORIGIN).set("Cookie", buyer).send({ deliverySpeed: "STANDARD" }).expect(409);
    expect(((await priceAll(third).expect(200)).body as ShoppingRequestView).status).toBe("QUOTED");
    await submit(BUYER);
    const fourth = (await mine(buyer))[0]!;
    expect(((await http().post(`/v1/buyer/shopping/${fourth.id}/cancel`).set("Origin", WEB_ORIGIN).set("Cookie", buyer).expect(200)).body as ShoppingRequestView).status).toBe("CANCELLED");
  });
});
