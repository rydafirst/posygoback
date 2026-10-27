import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import type { OrderDetailView, ReturnableOrderView, VendorReturnView } from "../src/shared";
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
import { as, GB_RECIPIENT, inDays } from "./partner-helpers";

const OWNER = "owner@trail-stock.example";
const AREAS = ["stock.", "order.", "return."];

describe("email trail: stock shipments, orders and returns", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let operator: string;
  let countryOps: string;
  let warehouseId: string;
  let productId: string;

  const http = () => test.http();
  const kinds = () => test.email.sent.filter((message) => message.to === OWNER && AREAS.some((area) => message.kind?.startsWith(area))).map((message) => message.kind);
  const kindsSince = (start: number) => kinds().slice(start);
  const last = () => test.email.lastTo(OWNER)!;

  const inbound = (id: string, body: object, token = operator) => http().post(`/v1/warehouse/inbound/${id}/actions`).set(as(token)).send(body).expect(200);
  const order = (id: string, path: string, body: object = {}, token = operator) => http().post(`/v1/warehouse/orders/${id}/${path}`).set(as(token)).send(body).expect(200);
  const carrierUpdate = (id: string, status: string, description: string) => order(id, "sandbox-tracking", { status, description });

  async function submittedShipment(quantity: number): Promise<string> {
    const draft = await http()
      .post("/v1/vendor/inbound")
      .set(as(owner))
      .send({ shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 2 }, lines: [{ productId, quantity }] })
      .expect(201);
    await http().post(`/v1/vendor/inbound/${draft.body.id}/actions`).set(as(owner)).send({ action: "SUBMIT" }).expect(200);
    return draft.body.id as string;
  }

  async function placed(): Promise<string> {
    const created = await http()
      .post("/v1/vendor/orders")
      .set(as(owner))
      .send({ deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 1 }] }] })
      .expect(201);
    return created.body[0].id as string;
  }

  async function labelled(id: string): Promise<OrderDetailView> {
    await order(id, "scans", { code: "TRAIL-WIG" });
    await order(id, "pack", { dimensions: { lengthMm: 300, widthMm: 200, heightMm: 100 }, weightGrams: 420 });
    const rated = await order(id, "actions", { action: "FETCH_RATES" });
    return (await order(id, "actions", { action: "SELECT_RATE", rateId: rated.body.rates[0].id })).body as OrderDetailView;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
    owner = (await signUpAndVerify(test, OWNER)).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 50_000);
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    operator = await createStaff(test, "operator@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    countryOps = await createStaff(test, "ops@gfn.test", "COUNTRY_OPS", "GB");
    warehouseId = (
      await http()
        .post("/v1/warehouse/warehouses")
        .set(as(superAdmin))
        .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
        .expect(201)
    ).body.id;
    productId = (
      await http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({
          countryOfOrigin: "CN",
          declaredValueMinor: 4500,
          weightGrams: 350,
          storageTier: "SMALL",
          code: "wig-1",
          name: "Body wave wig",
          barcodes: [{ value: "TRAIL-WIG", symbology: "CODE128" }],
        })
        .expect(201)
    ).body.id;
    await seedStock({ vendorId, productId, warehouseId, quantity: 20 });
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("emails at each step of a stock shipment, from submission to receipt", async () => {
    const id = await submittedShipment(40);
    const submitted = last();
    expect(submitted.kind).toBe("stock.shipment_submitted");
    expect(submitted.text).toContain("Posygo Manchester\nUnit 4, Trafford Park\nManchester M17 1AA");
    expect(submitted.text).toMatch(/We've taken £\d+\.\d{2} from your wallet/);
    expect(submitted.action).toEqual({ label: "Open the shipment", url: `${WEB_ORIGIN}/inbound/${id}` });

    await inbound(id, { action: "CHECK_IN" });
    await inbound(id, { action: "HOLD", reason: "Two boxes arrived crushed, checking contents." });
    expect(last().text).toContain("arrived crushed");
    await http().post(`/v1/warehouse/inbound/${id}/messages`).set(as(operator)).send({ body: "Photos to follow." }).expect(200);
    await http().post(`/v1/vendor/inbound/${id}/messages`).set(as(owner)).send({ body: "Thanks, please go ahead." }).expect(200);
    await inbound(id, { action: "RELEASE" });

    const detail = await http().get(`/v1/warehouse/inbound/${id}`).set(as(operator)).expect(200);
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    await http()
      .post(`/v1/warehouse/inbound/${id}/receive`)
      .set(as(operator))
      .send({ boxCounts: { SMALL: 2 }, photoFileIds: [photo], lines: [{ lineId: detail.body.lines[0].id, acceptedQuantity: 40, damagedQuantity: 0 }] })
      .expect(200);

    expect(kinds()).toEqual(["stock.shipment_submitted", "stock.shipment_arrived", "stock.shipment_on_hold", "stock.shipment_message", "stock.shipment_released", "stock.shipment_received"]);
    expect(test.email.sent.filter((message) => message.to === OWNER && message.kind?.startsWith("stock.")).every((message) => message.action?.url === `${WEB_ORIGIN}/inbound/${id}`)).toBe(true);
  });

  it("tells the vendor when a shipment is refused", async () => {
    const id = await submittedShipment(5);
    const start = kinds().length;
    await inbound(id, { action: "CHECK_IN" });
    await inbound(id, { action: "REJECT", reason: "The boxes were soaked through and the stock is unusable." });
    expect(kindsSince(start)).toEqual(["stock.shipment_arrived", "stock.shipment_refused"]);
    expect(last().text).toContain("soaked through");
  });

  it("emails when an order is held, released and handed to the carrier, but not for every carrier scan", async () => {
    const start = kinds().length;
    const id = await placed();
    await order(id, "actions", { action: "HOLD", reason: "Checking the address with the customer." });
    expect(last().text).toContain("Checking the address");
    await order(id, "actions", { action: "RELEASE" });
    const label = (await labelled(id)).label!;
    await order(id, "actions", { action: "HAND_OFF" });
    const shipped = last();
    expect(shipped.kind).toBe("order.shipped");
    expect(shipped.subject).not.toContain(label.trackingNumber);
    expect(shipped.text).toContain(`Tracking number: ${label.trackingNumber}`);
    expect(shipped.action).toEqual({ label: "Open the order", url: `${WEB_ORIGIN}/orders/${id}` });

    await carrierUpdate(id, "IN_TRANSIT", "Departed facility");
    await carrierUpdate(id, "FAILURE", "Delivery attempted, nobody home");
    expect(last().text).toContain("nobody home");
    await carrierUpdate(id, "DELIVERED", "Delivered to front door");

    expect(kindsSince(start)).toEqual(["order.on_hold", "order.released", "order.shipped", "order.carrier_problem"]);
  });

  it("emails once when the carrier picks up a parcel that was never handed over, and when it comes back", async () => {
    const start = kinds().length;
    const id = await placed();
    await labelled(id);
    await carrierUpdate(id, "IN_TRANSIT", "Collected from sender");
    await carrierUpdate(id, "RETURNED", "Returned to sender");
    expect(kindsSince(start)).toEqual(["order.shipped", "order.returned_to_hub"]);
  });

  it("emails when a cancellation request is declined and when staff cancel the order", async () => {
    const start = kinds().length;
    const id = await placed();
    await order(id, "scans", { code: "TRAIL-WIG" });
    await order(id, "pack", { dimensions: { lengthMm: 300, widthMm: 200, heightMm: 100 }, weightGrams: 420 });
    await http().post(`/v1/vendor/orders/${id}/actions`).set(as(owner)).send({ action: "REQUEST_CANCELLATION", reason: "WRONG_ITEMS" }).expect(200);
    await order(id, "cancellation-decision", { approve: false, note: "Already sealed for collection" }, countryOps);
    await order(id, "actions", { action: "CANCEL", reason: "ADDRESS_PROBLEM", note: "Recipient moved away" }, countryOps);
    expect(kindsSince(start)).toEqual(["order.cancellation_declined", "order.cancelled"]);
    expect(last().text).toContain("returned to your wallet");
  });

  it("emails when a return arrives, when it's done, and when a parcel turns up empty", async () => {
    const id = await placed();
    await labelled(id);
    await order(id, "actions", { action: "HAND_OFF" });
    const line = ((await http().get(`/v1/vendor/returns/orders/${id}`).set(as(owner)).expect(200)).body as ReturnableOrderView).lines[0]!;
    const open = async () =>
      (
        await http()
          .post("/v1/vendor/returns")
          .set(as(owner))
          .send({ orderId: id, reason: "Wrong colour", lines: [{ lineId: line.lineId, quantity: 1 }] })
          .expect(201)
      ).body as VendorReturnView;
    const receive = async (entry: VendorReturnView, receivedQuantity: number) => {
      const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
      await http()
        .post(`/v1/warehouse/returns/${entry.id}/receive`)
        .set(as(operator))
        .send({ lines: [{ lineId: entry.lines[0]!.id, receivedQuantity }], photoFileIds: [photo] })
        .expect(200);
    };
    const start = kinds().length;

    const empty = await open();
    await receive(empty, 0);
    expect(last().subject).toBe(`Return ${empty.reference} is closed`);

    const rma = await open();
    await receive(rma, 1);
    expect(last().action).toEqual({ label: "Tell us what to do", url: `${WEB_ORIGIN}/returns` });
    await http()
      .post(`/v1/vendor/returns/${rma.id}/instructions`)
      .set(as(owner))
      .send({ lines: [{ lineId: rma.lines[0]!.id, restock: 1, dispose: 0, donate: 0 }] })
      .expect(200);
    await http().post(`/v1/warehouse/returns/${rma.id}/complete`).set(as(operator)).expect(200);

    expect(kindsSince(start)).toEqual(["return.arrived_empty", "return.arrived", "return.completed"]);
  });
});
