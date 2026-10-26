import { ReturnUpkeepService } from "../src/modules/returns/return-upkeep.service";
import type { ReturnableOrderView, VendorReturnView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile } from "./harness";
import { as, query } from "./partner-helpers";

const RECIPIENT = { name: "Ada Obi", line1: "1 High Street", city: "Manchester", postalCode: "M1 1AA", countryCode: "GB" };
const SENT_STEPS = ["PENDING_PACKING", "PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "SHIPPING_PAID", "LABEL_PURCHASED", "HANDED_OFF"];

describe("vendor returns", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let otherOwner: string;
  let operator: string;
  let usOperator: string;
  let productId: string;
  let warehouseId: string;
  let orderId: string;
  let lineId: string;
  let rma: VendorReturnView;

  const http = () => test.http();
  const balance = async () => (await http().get("/v1/vendor/wallet").set(as(owner)).expect(200)).body.balanceMinor as number;
  const placeSentOrder = async (quantity: number) => {
    const [order] = (
      await http()
        .post("/v1/vendor/orders")
        .set(as(owner))
        .send({ deliveries: [{ recipient: RECIPIENT, lines: [{ productId, quantity }] }] })
        .expect(201)
    ).body as Array<{ id: string }>;
    for (let step = 1; step < SENT_STEPS.length; step += 1) {
      await query("UPDATE orders SET status = $3::order_status WHERE id = $1 AND status = $2::order_status", [order!.id, SENT_STEPS[step - 1], SENT_STEPS[step]]);
    }
    await query("UPDATE orders SET handed_off_at = now() WHERE id = $1", [order!.id]);
    return order!.id;
  };
  const open = (body: object, token = owner) => http().post("/v1/vendor/returns").set(as(token)).send(body);
  const receive = async (entry: VendorReturnView, received: number[], status: number, token = operator) => {
    const photo = await uploadVerifiedFile(test, token, "EVIDENCE_PHOTO");
    return http()
      .post(`/v1/warehouse/returns/${entry.id}/receive`)
      .set(as(token))
      .send({ lines: entry.lines.map((line, index) => ({ lineId: line.id, receivedQuantity: received[index] })), photoFileIds: [photo], notes: "Box dented, items fine" })
      .expect(status);
  };

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@returns.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 20_000);
    otherOwner = (await signUpAndVerify(test, "other@returns.example")).accessToken;
    await makeVendorTrade((await http().get("/v1/auth/me").set(as(otherOwner))).body.vendorId);
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    warehouseId = (
      await http()
        .post("/v1/warehouse/warehouses")
        .set(as(superAdmin))
        .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
        .expect(201)
    ).body.id;
    operator = await createStaff(test, "operator@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    usOperator = await createStaff(test, "us-operator@gfn.test", "WAREHOUSE_OPERATOR", "US");
    productId = (
      await http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL", code: "wig-1", name: "Body wave wig", barcodes: [{ value: "WIG-1", symbology: "CODE128" }] })
        .expect(201)
    ).body.id;
    await seedStock({ vendorId, productId, warehouseId, quantity: 20 });
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("opening a return", () => {
    it("only for orders that have left, for no more than was sent, and takes the handling fee", async () => {
      const [waiting] = (
        await http()
          .post("/v1/vendor/orders")
          .set(as(owner))
          .send({ deliveries: [{ recipient: RECIPIENT, lines: [{ productId, quantity: 1 }] }] })
          .expect(201)
      ).body as Array<{ id: string }>;
      await http().get(`/v1/vendor/returns/orders/${waiting!.id}`).set(as(owner)).expect(409);
      orderId = await placeSentOrder(3);
      const returnable = (await http().get(`/v1/vendor/returns/orders/${orderId}`).set(as(owner)).expect(200)).body as ReturnableOrderView;
      expect(returnable).toMatchObject({ feeMinor: 600, lines: [{ shippedQuantity: 3, returnableQuantity: 3 }] });
      lineId = returnable.lines[0]!.lineId;
      await http().get(`/v1/vendor/returns/orders/${orderId}`).set(as(otherOwner)).expect(404);
      await open({ orderId, reason: "Wrong colour", lines: [{ lineId, quantity: 2 }] }, otherOwner).expect(404);
      const before = await balance();
      rma = (await open({ orderId, reason: "Wrong colour", lines: [{ lineId, quantity: 2 }] }).expect(201)).body as VendorReturnView;
      expect(rma).toMatchObject({ status: "REQUESTED", feeMinor: 600, returnAddress: { name: "Manchester", postalCode: "M17 1AA" }, lines: [{ requestedQuantity: 2 }] });
      expect(await balance()).toBe(before - 600);
      const tooMany = await open({ orderId, reason: "More of them", lines: [{ lineId, quantity: 2 }] }).expect(400);
      expect(Object.values(tooMany.body.fieldErrors as Record<string, string[]>)[0]![0]).toMatch(/Only 1/);
    });

    it("refuses once the return window has passed", async () => {
      const late = await placeSentOrder(1);
      await query("UPDATE orders SET handed_off_at = now() - interval '91 days' WHERE id = $1", [late]);
      const line = ((await http().get(`/v1/vendor/returns/orders/${late}`).set(as(owner)).expect(200)).body as ReturnableOrderView).lines[0]!;
      expect((await open({ orderId: late, reason: "Too late", lines: [{ lineId: line.lineId, quantity: 1 }] }).expect(409)).body.message).toMatch(/90 days/);
    });
  });

  describe("at the warehouse", () => {
    it("is only seen by the warehouse it's going to, and needs photos to receive", async () => {
      await http().get(`/v1/warehouse/returns/${rma.id}`).set(as(usOperator)).expect(404);
      const listed = (await http().get("/v1/warehouse/returns?status=REQUESTED").set(as(operator)).expect(200)).body as VendorReturnView[];
      expect(listed.map((entry) => entry.reference)).toContain(rma.reference);
      expect(listed[0]!.returnAddress).toBeNull();
      await http()
        .post(`/v1/warehouse/returns/${rma.id}/receive`)
        .set(as(operator))
        .send({ lines: [{ lineId: rma.lines[0]!.id, receivedQuantity: 2 }], photoFileIds: [] })
        .expect(400);
      await receive(rma, [3], 400);
    });

    it("records what arrived and asks the vendor what to do", async () => {
      const received = (await receive(rma, [2], 200)).body as VendorReturnView;
      expect(received).toMatchObject({ status: "RECEIVED", receiveNotes: "Box dented, items fine", lines: [{ receivedQuantity: 2 }] });
      expect(test.email.lastTo("owner@returns.example")!.subject).toBe(`Return ${rma.reference} has arrived`);
      await http().post(`/v1/vendor/returns/${rma.id}/cancel`).set(as(owner)).expect(409);
      await receive(rma, [2], 409);
      const photoId = received.photoFileIds[0]!;
      await http().post(`/v1/vendor/returns/${rma.id}/photos/${photoId}/url`).set(as(owner)).expect(200);
      await http().post(`/v1/vendor/returns/${rma.id}/photos/${photoId}/url`).set(as(otherOwner)).expect(404);
    });
  });

  describe("finishing", () => {
    it("puts restocked items back on sale and records the custody trail", async () => {
      const line = rma.lines[0]!.id;
      await http().post(`/v1/warehouse/returns/${rma.id}/complete`).set(as(operator)).expect(409);
      await http()
        .post(`/v1/vendor/returns/${rma.id}/instructions`)
        .set(as(owner))
        .send({ lines: [{ lineId: line, restock: 2, dispose: 1, donate: 0 }] })
        .expect(400);
      await http()
        .post(`/v1/vendor/returns/${rma.id}/instructions`)
        .set(as(owner))
        .send({ lines: [{ lineId: line, restock: 1, dispose: 1, donate: 0 }] })
        .expect(200);
      const done = (await http().post(`/v1/warehouse/returns/${rma.id}/complete`).set(as(operator)).expect(200)).body as VendorReturnView;
      expect(done).toMatchObject({ status: "COMPLETED", lines: [{ restockQuantity: 1, disposeQuantity: 1 }] });
      const [lot] = await query<{ id: string; quantity_available: number; condition: string }>(
        "SELECT l.id, l.quantity_available, l.condition::text FROM vendor_return_lines r JOIN stock_lots l ON l.id = r.restock_lot_id WHERE r.return_id = $1",
        [rma.id],
      );
      expect(lot).toMatchObject({ quantity_available: 1, condition: "SELLABLE" });
      expect(await query("SELECT id FROM inventory_movements WHERE lot_id = $1 AND type = 'RETURN_IN'", [lot!.id])).toHaveLength(1);
      expect(await query("SELECT id FROM custody_events WHERE lot_id = $1 AND type = 'RETURNED'", [lot!.id])).toHaveLength(1);
      expect(test.email.lastTo("owner@returns.example")!.subject).toBe(`Return ${rma.reference} is done`);
    });

    it("marks the order returned once everything sent has come back", async () => {
      const second = (await open({ orderId, reason: "Last one", lines: [{ lineId, quantity: 1 }] }).expect(201)).body as VendorReturnView;
      await receive(second, [1], 200);
      await http()
        .post(`/v1/vendor/returns/${second.id}/instructions`)
        .set(as(owner))
        .send({ lines: [{ lineId: second.lines[0]!.id, restock: 0, dispose: 0, donate: 1 }] })
        .expect(200);
      await http().post(`/v1/warehouse/returns/${second.id}/complete`).set(as(operator)).expect(200);
      expect((await query<{ status: string }>("SELECT status::text FROM orders WHERE id = $1", [orderId]))[0]!.status).toBe("RETURNED");
    });

    it("gives the fee back when a return is cancelled or never arrives, and restocks by default when the vendor is silent", async () => {
      const spare = await placeSentOrder(2);
      const spareLine = ((await http().get(`/v1/vendor/returns/orders/${spare}`).set(as(owner)).expect(200)).body as ReturnableOrderView).lines[0]!.lineId;
      const cancelled = (await open({ orderId: spare, reason: "Changed mind", lines: [{ lineId: spareLine, quantity: 1 }] }).expect(201)).body as VendorReturnView;
      const before = await balance();
      await http().post(`/v1/vendor/returns/${cancelled.id}/cancel`).set(as(owner)).expect(200);
      expect(await balance()).toBe(before + 600);
      const lost = (await open({ orderId: spare, reason: "Lost in post", lines: [{ lineId: spareLine, quantity: 1 }] }).expect(201)).body as VendorReturnView;
      await query("UPDATE vendor_returns SET created_at = now() - interval '46 days' WHERE id = $1", [lost.id]);
      const beforeExpiry = await balance();
      expect(await test.app.get(ReturnUpkeepService).expireUnreceived()).toBe(1);
      expect(await balance()).toBe(beforeExpiry + 600);
      const silent = (await open({ orderId: spare, reason: "Faulty", lines: [{ lineId: spareLine, quantity: 1 }] }).expect(201)).body as VendorReturnView;
      await receive(silent, [1], 200);
      await query("UPDATE vendor_returns SET received_at = now() - interval '15 days' WHERE id = $1", [silent.id]);
      expect(await test.app.get(ReturnUpkeepService).restockUninstructed()).toBe(1);
      const instructed = (await http().get(`/v1/vendor/returns/${silent.id}`).set(as(owner)).expect(200)).body as VendorReturnView;
      expect(instructed).toMatchObject({ status: "INSTRUCTED", lines: [{ restockQuantity: 1 }] });
    });
  });
});
