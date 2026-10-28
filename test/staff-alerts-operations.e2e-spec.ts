import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import type { ClaimView, NotificationFeedView, ReturnableOrderView, ShoppingRequestView, StockCountView, VendorReturnView } from "../src/shared";
import {
  createStaff,
  flushRateLimits,
  fundWallet,
  insertLegalDocument,
  makeVendorTrade,
  resetDatabase,
  seedStock,
  signUpAndVerify,
  startApp,
  type TestApp,
  uploadVerifiedFile,
  WEB_ORIGIN,
} from "./harness";
import { as, GB_RECIPIENT, inDays, PartnerFlow, query } from "./partner-helpers";
import { SHIP_TO } from "./store-helpers";

const SHOPPER = "shopper@staff-alerts.example";

describe("staff alerts for operations work", () => {
  let test: TestApp;
  let superAdmin: string;
  let ops: string;
  let finance: string;
  let operator: string;
  let watcher: string;
  let owner: string;
  let vendorId: string;
  let productId: string;
  let warehouseId: string;

  const http = () => test.http();
  const post = (token: string, path: string, body: object = {}) => http().post(path).set(as(token)).send(body);
  const feed = async (token: string) => ((await http().get("/v1/notifications").set(as(token)).expect(200)).body as NotificationFeedView).items;
  const expectAlert = async (token: string, title: string, href: string) => expect(await feed(token)).toContainEqual(expect.objectContaining({ title, href }));
  const expectNoAlert = async (token: string, title: string) => expect((await feed(token)).map((item) => item.title)).not.toContain(title);

  const order = (id: string, path: string, body: object = {}) => post(operator, `/v1/warehouse/orders/${id}/${path}`, body).expect(200);

  async function placed(): Promise<string> {
    const created = await post(owner, "/v1/vendor/orders", { deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 1 }] }] }).expect(201);
    return created.body[0].id as string;
  }

  async function handedOff(id: string): Promise<void> {
    await order(id, "scans", { code: "ALERT-WIG" });
    await order(id, "pack", { dimensions: { lengthMm: 300, widthMm: 200, heightMm: 100 }, weightGrams: 420 });
    const rated = await order(id, "actions", { action: "FETCH_RATES" });
    await order(id, "actions", { action: "SELECT_RATE", rateId: rated.body.rates[0].id });
    await order(id, "actions", { action: "HAND_OFF" });
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
    const staff = async (email: string, role: string, country: string | null = null) => {
      await flushRateLimits();
      return createStaff(test, email, role, country);
    };
    superAdmin = await staff("super@alerts.test", "SUPER_ADMIN");
    ops = await staff("ops@alerts.test", "COUNTRY_OPS", "GB");
    finance = await staff("finance@alerts.test", "FINANCE_ADMIN");
    operator = await staff("operator@alerts.test", "WAREHOUSE_OPERATOR", "GB");
    watcher = await staff("watcher@alerts.test", "WAREHOUSE_OPERATOR", "GB");
    await flushRateLimits();
    owner = (await signUpAndVerify(test, "owner@staff-alerts.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 50_000);
    warehouseId = (
      await post(superAdmin, "/v1/warehouse/warehouses", {
        countryCode: "GB",
        code: "MAN-1",
        name: "Manchester",
        addressLines: ["Unit 4, Trafford Park"],
        city: "Manchester",
        postalCode: "M17 1AA",
      }).expect(201)
    ).body.id;
    productId = (
      await post(owner, "/v1/vendor/products", {
        code: "wig-1",
        name: "Lace wig",
        countryOfOrigin: "CN",
        declaredValueMinor: 4_500,
        weightGrams: 350,
        storageTier: "SMALL",
        barcodes: [{ value: "ALERT-WIG", symbology: "CODE128" }],
      }).expect(201)
    ).body.id;
    await seedStock({ vendorId, productId, warehouseId, quantity: 20 });
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("tells receiving staff when a stock shipment arrives and when it's put on hold", async () => {
    const draft = await post(owner, "/v1/vendor/inbound", { shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 2 }, lines: [{ productId, quantity: 10 }] }).expect(201);
    const { id, reference } = draft.body as { id: string; reference: string };
    await post(owner, `/v1/vendor/inbound/${id}/actions`, { action: "SUBMIT" }).expect(200);
    const businessName = (await http().get("/v1/auth/me").set(as(owner))).body.businessName as string;
    await expectAlert(watcher, `${businessName} sent stock shipment ${reference}`, `/admin/receiving/${id}`);
    expect(test.email.lastTo("watcher@alerts.test")?.subject ?? "").not.toContain(reference);

    await post(operator, `/v1/warehouse/inbound/${id}/actions`, { action: "CHECK_IN" }).expect(200);
    await expectAlert(watcher, `Stock shipment ${reference} arrived at Manchester`, `/admin/receiving/${id}`);
    await expectNoAlert(operator, `Stock shipment ${reference} arrived at Manchester`);

    await post(operator, `/v1/warehouse/inbound/${id}/actions`, { action: "HOLD", reason: "Two boxes arrived crushed, checking contents." }).expect(200);
    await expectAlert(watcher, `Stock shipment ${reference} is on hold at Manchester`, `/admin/receiving/${id}`);
  });

  it("tells staff when an order is put on hold or the carrier reports a problem", async () => {
    const id = await placed();
    const held = await order(id, "actions", { action: "HOLD", reason: "Checking the address with the customer." });
    const reference = held.body.reference as string;
    await expectAlert(ops, `Order ${reference} is on hold`, `/admin/orders/${id}`);
    await expectNoAlert(operator, `Order ${reference} is on hold`);

    await order(id, "actions", { action: "RELEASE" });
    await handedOff(id);
    await order(id, "sandbox-tracking", { status: "FAILURE", description: "Delivery attempted, nobody home" });
    await expectAlert(ops, `Order ${reference} has a carrier problem`, `/admin/orders/${id}`);
  });

  it("tells warehouse staff when a return is ready to finish", async () => {
    const id = await placed();
    await handedOff(id);
    const line = ((await http().get(`/v1/vendor/returns/orders/${id}`).set(as(owner)).expect(200)).body as ReturnableOrderView).lines[0]!;
    const rma = (await post(owner, "/v1/vendor/returns", { orderId: id, reason: "Wrong colour", lines: [{ lineId: line.lineId, quantity: 1 }] }).expect(201)).body as VendorReturnView;
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    await post(operator, `/v1/warehouse/returns/${rma.id}/receive`, { lines: [{ lineId: rma.lines[0]!.id, receivedQuantity: 1 }], photoFileIds: [photo] }).expect(200);
    await post(owner, `/v1/vendor/returns/${rma.id}/instructions`, { lines: [{ lineId: rma.lines[0]!.id, restock: 1, dispose: 0, donate: 0 }] }).expect(200);
    await expectAlert(watcher, `Return ${rma.reference} ready to finish`, "/admin/returns");
  });

  it("asks for a claim to be assessed, then decided by someone else", async () => {
    const lotId = await seedStock({ vendorId, productId, warehouseId, quantity: 3 });
    const photo = await uploadVerifiedFile(test, owner, "GENERAL_ATTACHMENT");
    const claim = (await post(owner, "/v1/vendor/claims", { lotId, kind: "DAMAGE", quantity: 1, description: "One wig arrived crushed.", fileIds: [photo] }).expect(201)).body as ClaimView;
    await expectAlert(ops, `Claim ${claim.reference} to assess`, "/admin/claims");

    await post(superAdmin, `/v1/admin/claims/${claim.id}/assessment`, { liability: "PLATFORM", amountMinor: 4_500, writeOff: false, note: "The box was crushed in our hub." }).expect(200);
    await expectAlert(finance, `Claim ${claim.reference} to decide`, "/admin/claims");
    await expectNoAlert(superAdmin, `Claim ${claim.reference} to decide`);
  });

  it("raises a custody alert when a hub's count is short, and asks for the claims it opens to be assessed", async () => {
    const flow = new PartnerFlow(test);
    const compliance = await createStaff(test, "compliance@alerts.test", "COMPLIANCE");
    const hub = await flow.onboard("lead@alerts.test", "Ada Obi", compliance, superAdmin);
    await seedStock({ vendorId, productId, warehouseId: hub.hubId, quantity: 4 });
    await post(superAdmin, `/v1/admin/partners/${hub.partnerId}/stock-counts`, { lines: 5, dueInHours: 24 }).expect(201);
    const [count] = (await http().get("/v1/warehouse/stock-counts").set(as(hub.token)).expect(200)).body as StockCountView[];
    const video = await uploadVerifiedFile(test, hub.token, "STOCK_COUNT");
    const lines = count!.lines.map((line) => ({ lineId: line.id, countedQuantity: 1 }));
    await post(hub.token, `/v1/warehouse/stock-counts/${count!.id}/submit`, { videoFileId: video, lines }).expect(200);
    const alert = (await feed(ops)).find((item) => item.title.startsWith("Stock count didn't match at "));
    expect(alert).toMatchObject({ href: "/admin/custody-alerts", body: expect.stringContaining("didn't match on 1 item") });

    await post(superAdmin, `/v1/admin/stock-counts/${count!.id}/resolve`, { note: "Three missing on the video, opening a claim.", openClaims: true }).expect(200);
    const [claim] = await query<{ reference: string }>("SELECT reference FROM custody_claims WHERE stock_count_id = $1", [count!.id]);
    await expectAlert(ops, `Claim ${claim!.reference} to assess`, "/admin/claims");
  });

  it("follows a shopping request from confirmation to the warehouse", async () => {
    const boxId = (await post(superAdmin, "/v1/admin/packaging/GB", { code: "box-a", label: "Medium box", kind: "BOX", lengthMm: 400, widthMm: 300, heightMm: 200 }).expect(201)).body.id;
    const token = (path: RegExp) => path.exec(test.email.lastTo(SHOPPER)!.text)![1]!;
    const lines = [{ url: "https://shop.example/trainers", description: "White trainers, size 6", quantity: 1 }];
    const { reference } = (await http().post("/v1/public/shopping").send({ countryCode: "GB", buyerEmail: SHOPPER, buyerName: "Ada Obi", shipTo: SHIP_TO, lines }).expect(201)).body as {
      reference: string;
    };
    await http()
      .post("/v1/public/shopping/confirm")
      .set("Origin", WEB_ORIGIN)
      .send({ token: token(/\/shopping\/confirm#token=([A-Za-z0-9_-]{43})/) })
      .expect(200);
    await expectAlert(ops, `Shopping request ${reference} to price`, "/admin/shopping");

    await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email: SHOPPER }).expect(202);
    const session = await http()
      .post("/v1/buyer/auth/session")
      .set("Origin", WEB_ORIGIN)
      .send({ token: token(/#token=([A-Za-z0-9_-]{43})/) })
      .expect(200);
    const cookie = ([] as string[])
      .concat(session.headers["set-cookie"] ?? [])
      .find((value) => value.startsWith("gfn_bs="))!
      .split(";")[0]!;
    const request = ((await http().get("/v1/buyer/shopping").set("Cookie", cookie).expect(200)).body as ShoppingRequestView[])[0]!;
    const quoteLines = request.lines.map((line) => ({ lineId: line.id, available: true, unitPriceMinor: 2_000, unitWeightGrams: 300 }));
    await post(ops, `/v1/admin/shopping/${request.id}/quote`, { warehouseId, packagingPresetId: boxId, lines: quoteLines }).expect(200);
    await http().post(`/v1/buyer/shopping/${request.id}/checkout`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ deliverySpeed: "STANDARD" }).expect(200);
    await http().post(`/v1/buyer/shopping/by-reference/${reference}/sandbox-payment`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).expect(204);
    await expectAlert(ops, `Shopping request ${reference} is paid`, "/admin/shopping");

    await post(ops, `/v1/admin/shopping/${request.id}/purchase`, { lines: request.lines.map((line) => ({ lineId: line.id, bought: true })) }).expect(200);
    await expectAlert(watcher, `Shopping request ${reference} is bought`, "/admin/shopping-desk");

    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    await post(operator, `/v1/warehouse/shopping/${request.id}/arrival`, { lines: request.lines.map((line) => ({ lineId: line.id, receivedQuantity: 1 })), photoFileIds: [photo] }).expect(200);
    await expectAlert(watcher, `Shopping parcel ${reference} arrived at Manchester`, "/admin/shopping-desk");
    await expectNoAlert(operator, `Shopping parcel ${reference} arrived at Manchester`);
  });

  it("lets an admin choose which alerts are also emailed", async () => {
    const settings = (await http().get("/v1/admin/email-alerts").set(as(superAdmin)).expect(200)).body as Array<{ topic: string; label: string; enabled: boolean }>;
    expect(settings).toContainEqual({ topic: "inboundSubmitted", label: "Stock shipments sent by sellers", enabled: false });
    expect(settings).toContainEqual(expect.objectContaining({ topic: "support", enabled: true }));
    await http().put("/v1/admin/email-alerts/inboundSubmitted").set(as(finance)).send({ enabled: true }).expect(404);
    await http().put("/v1/admin/email-alerts/nonsense").set(as(superAdmin)).send({ enabled: true }).expect(404);
    const changed = (await http().put("/v1/admin/email-alerts/inboundSubmitted").set(as(superAdmin)).send({ enabled: true }).expect(200)).body as Array<{ topic: string; enabled: boolean }>;
    expect(changed).toContainEqual(expect.objectContaining({ topic: "inboundSubmitted", enabled: true }));

    const draft = await post(owner, "/v1/vendor/inbound", { warehouseId, shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 2 }, lines: [{ productId, quantity: 10 }] }).expect(
      201,
    );
    const { id, reference } = draft.body as { id: string; reference: string };
    await post(owner, `/v1/vendor/inbound/${id}/actions`, { action: "SUBMIT" }).expect(200);
    expect(test.email.lastTo("watcher@alerts.test")?.subject).toContain(reference);
    expect(test.email.lastTo("watcher@alerts.test")?.action?.url).toContain(`/admin/receiving/${id}`);
    await http().put("/v1/admin/email-alerts/inboundSubmitted").set(as(superAdmin)).send({ enabled: false }).expect(200);
  });
});
