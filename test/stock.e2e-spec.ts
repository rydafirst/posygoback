import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile } from "./harness";

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function inDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const PRODUCT = {
  code: "wig-bw-16",
  name: "Body wave wig 16 inch",
  countryOfOrigin: "CN",
  declaredValueMinor: 4500,
  weightGrams: 350,
  storageTier: "SMALL",
  barcodes: [{ value: "4006381333931", symbology: "EAN13" }],
};

describe("catalogue, inbound and inventory", () => {
  let test: TestApp;
  let owner: string;
  let vendorId: string;
  let otherVendor: string;
  let superAdmin: string;
  let gbOperator: string;
  let usOperator: string;
  let countryOps: string;
  let warehouseId: string;
  let productId: string;
  let inboundId: string;
  const locations: Record<string, string> = {};

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@stock.example")).accessToken;
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner)).expect(200)).body.vendorId;
    otherVendor = (await signUpAndVerify(test, "other@stock.example")).accessToken;
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    gbOperator = await createStaff(test, "operator-gb@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    usOperator = await createStaff(test, "operator-us@gfn.test", "WAREHOUSE_OPERATOR", "US");
    countryOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("staff invitations", () => {
    it("lets only super admins invite staff, never another super admin", async () => {
      await test.http().post("/v1/admin/staff/invitations").set(as(countryOps)).send({ email: "x@gfn.test", role: "COMPLIANCE" }).expect(404);
      await test.http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "x@gfn.test", role: "SUPER_ADMIN" }).expect(400);
      await test.http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "x@gfn.test", role: "WAREHOUSE_OPERATOR" }).expect(400);
      await test.http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "owner@stock.example", role: "COMPLIANCE" }).expect(409);
    });

    it("creates the account on acceptance and still requires two-factor setup", async () => {
      await test.http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "new-operator@gfn.test", role: "WAREHOUSE_OPERATOR", countryCode: "GB" }).expect(202);
      const token = decodeURIComponent(/#token=([^\s]+)/.exec(test.email.lastTo("new-operator@gfn.test")!.text)![1]!);
      const preview = await test.http().post("/v1/staff-invitations/preview").send({ token }).expect(200);
      expect(preview.body).toEqual({ email: "new-operator@gfn.test", role: "WAREHOUSE_OPERATOR", countryCode: "GB", partnerName: null, purpose: "TEAM" });
      const accepted = await test.http().post("/v1/staff-invitations/accept").send({ token, password: "an operator's own password" }).expect(200);
      expect(accepted.body.user.mfaState).toBe("ENROLMENT_REQUIRED");
      await test.http().get("/v1/warehouse/warehouses").set(as(accepted.body.accessToken)).expect(403);
      await test.http().post("/v1/staff-invitations/accept").send({ token, password: "replaying the invite" }).expect(400);
      const directory = await test.http().get("/v1/admin/staff").set(as(superAdmin)).expect(200);
      expect((directory.body.members as Array<{ email: string }>).map((member) => member.email)).toContain("new-operator@gfn.test");
    });

    it("changes a staff member's role and signs them out", async () => {
      await test.http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "new-admin@gfn.test", role: "ADMIN" }).expect(202);
      const token = decodeURIComponent(/#token=([^\s]+)/.exec(test.email.lastTo("new-admin@gfn.test")!.text)![1]!);
      const accepted = await test.http().post("/v1/staff-invitations/accept").send({ token, password: "an admin's own password" }).expect(200);
      const userId: string = accepted.body.user.id;
      const path = `/v1/admin/staff/members/${userId}/role`;

      await test.http().put(path).set(as(countryOps)).send({ role: "COMPLIANCE" }).expect(404);
      await test.http().put(path).set(as(superAdmin)).send({ role: "SUPER_ADMIN" }).expect(400);
      await test.http().put(path).set(as(superAdmin)).send({ role: "COUNTRY_OPS" }).expect(400);
      await test.http().put(path).set(as(superAdmin)).send({ role: "ADMIN" }).expect(409);
      await test.http().put(path).set(as(superAdmin)).send({ role: "COMPLIANCE" }).expect(204);

      const [user] = await query<{ role: string; country_code: string | null }>("SELECT role, country_code FROM users WHERE id = $1", [userId]);
      expect(user).toEqual({ role: "COMPLIANCE", country_code: null });
      const open = await query("SELECT 1 FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      expect(open).toHaveLength(0);
      expect(test.email.lastTo("new-admin@gfn.test")!.subject).toContain("role has changed");
      const [audit] = await query<{ action: string }>("SELECT action FROM audit_log_entries WHERE resource_id = $1 AND action = 'staff.role_changed'", [userId]);
      expect(audit).toBeDefined();
    });

    it("never changes a super admin's role", async () => {
      const directory = await test.http().get("/v1/admin/staff").set(as(superAdmin)).expect(200);
      const superAdmins = (directory.body.members as Array<{ userId: string; role: string }>).filter((member) => member.role === "SUPER_ADMIN");
      for (const member of superAdmins) {
        await test.http().put(`/v1/admin/staff/members/${member.userId}/role`).set(as(superAdmin)).send({ role: "ADMIN" }).expect((response) => expect([404, 409]).toContain(response.status));
      }
      const [stillSuper] = await query<{ count: string }>("SELECT count(*) FROM users WHERE role = 'SUPER_ADMIN'");
      expect(Number(stillSuper!.count)).toBe(superAdmins.length);
    });
  });

  describe("warehouses", () => {
    it("is created by super admins and scoped to the operator's country", async () => {
      const created = await test
        .http()
        .post("/v1/warehouse/warehouses")
        .set(as(superAdmin))
        .send({ countryCode: "GB", code: "man-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
        .expect(201);
      warehouseId = created.body.id;
      expect(created.body.code).toBe("MAN-1");
      await test
        .http()
        .post("/v1/warehouse/warehouses")
        .set(as(gbOperator))
        .send({ countryCode: "GB", code: "X", name: "X", addressLines: ["x"], city: "x", postalCode: "x1" })
        .expect(404);
      expect((await test.http().get("/v1/warehouse/warehouses").set(as(gbOperator)).expect(200)).body).toHaveLength(1);
      expect((await test.http().get("/v1/warehouse/warehouses").set(as(usOperator)).expect(200)).body).toEqual([]);
      await test.http().get(`/v1/warehouse/warehouses/${warehouseId}/locations`).set(as(usOperator)).expect(404);
    });

    it("lets operators add locations with unique codes", async () => {
      for (const code of ["A-01", "A-02"]) {
        await test
          .http()
          .post(`/v1/warehouse/warehouses/${warehouseId}/locations`)
          .set(as(gbOperator))
          .send({ code, label: `Aisle A bay ${code}` })
          .expect(201);
      }
      await test.http().post(`/v1/warehouse/warehouses/${warehouseId}/locations`).set(as(gbOperator)).send({ code: "a-01", label: "Duplicate" }).expect(400);
      await test.http().post(`/v1/warehouse/warehouses/${warehouseId}/locations`).set(as(countryOps)).send({ code: "B-01", label: "Not allowed" }).expect(404);
      const listed = (await test.http().get(`/v1/warehouse/warehouses/${warehouseId}/locations`).set(as(gbOperator)).expect(200)).body as Array<{ id: string; code: string }>;
      for (const location of listed) {
        locations[location.code] = location.id;
      }
    });
  });

  describe("catalogue", () => {
    it("needs an active vendor with the current agreement", async () => {
      const refused = await test.http().post("/v1/vendor/products").set(as(owner)).send(PRODUCT).expect(403);
      expect(refused.body.message).toMatch(/verifying/);
      await makeVendorTrade(vendorId);
    });

    it("creates products with checked barcodes and unique codes", async () => {
      await test
        .http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...PRODUCT, barcodes: [{ value: "4006381333932", symbology: "EAN13" }] })
        .expect(400);
      const created = await test.http().post("/v1/vendor/products").set(as(owner)).send(PRODUCT).expect(201);
      productId = created.body.id;
      expect(created.body).toMatchObject({ code: "WIG-BW-16", declaredValue: { amountMinor: 4500, currency: "GBP" }, stock: { available: 0, reserved: 0, damaged: 0 } });
      const duplicate = await test.http().post("/v1/vendor/products").set(as(owner)).send(PRODUCT).expect(400);
      expect(duplicate.body.fieldErrors.code).toBeDefined();
      const reusedBarcode = await test
        .http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ ...PRODUCT, code: "OTHER" })
        .expect(400);
      expect(reusedBarcode.body.fieldErrors.barcodes).toBeDefined();
    });

    it("keeps each vendor's catalogue private", async () => {
      await test.http().get(`/v1/vendor/products/${productId}`).set(as(otherVendor)).expect(404);
      await test.http().get(`/v1/vendor/products/${productId}`).set(as(gbOperator)).expect(404);
      expect((await test.http().get("/v1/vendor/products").set(as(otherVendor)).expect(200)).body).toEqual([]);
    });

    it("only accepts product images uploaded by the same vendor", async () => {
      const foreign = await uploadVerifiedFile(test, otherVendor, "PRODUCT_IMAGE");
      await test
        .http()
        .put(`/v1/vendor/products/${productId}`)
        .set(as(owner))
        .send({ ...PRODUCT, imageFileId: foreign })
        .expect(400);
      const image = await uploadVerifiedFile(test, owner, "PRODUCT_IMAGE");
      await test
        .http()
        .put(`/v1/vendor/products/${productId}`)
        .set(as(owner))
        .send({ ...PRODUCT, imageFileId: image })
        .expect(200);
      await test.http().post(`/v1/vendor/products/${productId}/image-url`).set(as(owner)).expect(200);
    });
  });

  describe("inbound shipments", () => {
    const shipment = () => ({ shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 2 }, lines: [{ productId, quantity: 40 }] });

    it("checks the arrival date and that products belong to the vendor", async () => {
      await test
        .http()
        .post("/v1/vendor/inbound")
        .set(as(owner))
        .send({ ...shipment(), expectedArrivalDate: inDays(-1) })
        .expect(400);
      await makeVendorTrade((await test.http().get("/v1/auth/me").set(as(otherVendor))).body.vendorId);
      await test.http().post("/v1/vendor/inbound").set(as(otherVendor)).send(shipment()).expect(400);
    });

    it("lists the hubs a vendor can send stock to, named by city", async () => {
      const hubs = await test.http().get("/v1/vendor/inbound/hubs").set(as(owner)).expect(200);
      expect(hubs.body).toEqual([{ warehouseId: expect.any(String), label: "Manchester", city: "Manchester", area: "M17", unitsHeld: 0 }]);
    });

    it("drafts, edits and submits, then locks the declaration", async () => {
      const draft = await test.http().post("/v1/vendor/inbound").set(as(owner)).send(shipment()).expect(201);
      inboundId = draft.body.id;
      expect(draft.body).toMatchObject({ status: "DRAFT", warehouseName: "Manchester", actions: ["SUBMIT", "CANCEL"] });
      expect(draft.body.reference).toMatch(/^IN-GB-[A-Z2-9]{6}$/);
      await test.http().get(`/v1/warehouse/inbound/${inboundId}`).set(as(gbOperator)).expect(404);
      await test
        .http()
        .put(`/v1/vendor/inbound/${inboundId}`)
        .set(as(owner))
        .send({ ...shipment(), lines: [{ productId, quantity: 50 }] })
        .expect(200);
      const unfunded = await test.http().post(`/v1/vendor/inbound/${inboundId}/actions`).set(as(owner)).send({ action: "SUBMIT" }).expect(409);
      expect(unfunded.body.code).toBe("insufficient_funds");
      await fundWallet(vendorId, 10_000);
      const submitted = await test.http().post(`/v1/vendor/inbound/${inboundId}/actions`).set(as(owner)).send({ action: "SUBMIT" }).expect(200);
      expect(submitted.body.charges).toMatchObject({ currency: "GBP", onboardingFeeMinor: 1800 });
      expect(submitted.body).toMatchObject({ status: "SUBMITTED", totalUnits: 50, actions: ["CANCEL"] });
      await test.http().put(`/v1/vendor/inbound/${inboundId}`).set(as(owner)).send(shipment()).expect(409);
      await test.http().get(`/v1/vendor/inbound/${inboundId}`).set(as(otherVendor)).expect(404);
    });

    it("shows the shipment only to the warehouse's own country", async () => {
      const queue = (await test.http().get("/v1/warehouse/inbound").set(as(gbOperator)).expect(200)).body as Array<{ id: string }>;
      expect(queue.map((entry) => entry.id)).toContain(inboundId);
      expect((await test.http().get("/v1/warehouse/inbound").set(as(usOperator)).expect(200)).body).toEqual([]);
      await test.http().get(`/v1/warehouse/inbound/${inboundId}`).set(as(usOperator)).expect(404);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(countryOps)).send({ action: "CHECK_IN" }).expect(404);
    });

    it("holds with a reason the vendor is told about, then releases", async () => {
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "CHECK_IN" }).expect(200);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "HOLD" }).expect(400);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "HOLD", reason: "Two boxes arrived crushed, checking contents." }).expect(200);
      expect(test.email.lastTo("owner@stock.example")!.text).toContain("arrived crushed");
      await test.http().post(`/v1/vendor/inbound/${inboundId}/actions`).set(as(owner)).send({ action: "CANCEL" }).expect(409);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/messages`).set(as(gbOperator)).send({ body: "Photos to follow." }).expect(200);
      const reply = await test.http().post(`/v1/vendor/inbound/${inboundId}/messages`).set(as(owner)).send({ body: "Thanks, please go ahead." }).expect(200);
      expect(reply.body.messages).toHaveLength(2);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "RELEASE" }).expect(200);
    });

    it("lets the vendor pay a hold charge, which returns the shipment to where it was", async () => {
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "HOLD", reason: "Boxes need repacking before storage.", chargeMinor: 1500 }).expect(200);
      await test.http().post(`/v1/warehouse/inbound/${inboundId}/actions`).set(as(gbOperator)).send({ action: "CHECK_IN", chargeMinor: 1500 }).expect(400);
      const held = await test.http().get(`/v1/vendor/inbound/${inboundId}`).set(as(owner)).expect(200);
      expect(held.body).toMatchObject({ status: "ON_HOLD", actions: ["PAY_HOLD"], charges: { holdChargeMinor: 1500, holdPaidAt: null } });
      const paid = await test.http().post(`/v1/vendor/inbound/${inboundId}/actions`).set(as(owner)).send({ action: "PAY_HOLD" }).expect(200);
      expect(paid.body.status).toBe("ARRIVED");
      expect(paid.body.charges.holdPaidAt).not.toBeNull();
      const wallet = await test.http().get("/v1/vendor/wallet").set(as(owner)).expect(200);
      expect(wallet.body.balanceMinor).toBe(10_000 - 1800 - 1500);
    });

    it("refuses evidence the operator didn't upload", async () => {
      const vendorPhoto = await uploadVerifiedFile(test, owner, "PRODUCT_IMAGE");
      await test.http().post("/v1/files/uploads").set(as(owner)).send({ purpose: "EVIDENCE_PHOTO", contentType: "image/png", sizeBytes: 100 }).expect(404);
      await test.http().post("/v1/files/uploads").set(as(gbOperator)).send({ purpose: "KYC_DOCUMENT", contentType: "image/png", sizeBytes: 100 }).expect(404);
      const detail = await test.http().get(`/v1/warehouse/inbound/${inboundId}`).set(as(gbOperator)).expect(200);
      const lineId = detail.body.lines[0].id as string;
      await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundId}/receive`)
        .set(as(gbOperator))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [vendorPhoto], lines: [{ lineId, acceptedQuantity: 50, damagedQuantity: 0 }] })
        .expect(400);
      const usPhoto = await uploadVerifiedFile(test, usOperator, "EVIDENCE_PHOTO");
      await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundId}/receive`)
        .set(as(gbOperator))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [usPhoto], lines: [{ lineId, acceptedQuantity: 50, damagedQuantity: 0 }] })
        .expect(400);
    });

    it("receives with counts and photos, records damage as a discrepancy", async () => {
      const detail = await test.http().get(`/v1/warehouse/inbound/${inboundId}`).set(as(gbOperator)).expect(200);
      const lineId = detail.body.lines[0].id as string;
      const shipmentPhoto = await uploadVerifiedFile(test, gbOperator, "EVIDENCE_PHOTO");
      const damagePhoto = await uploadVerifiedFile(test, gbOperator, "EVIDENCE_PHOTO");
      await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundId}/receive`)
        .set(as(gbOperator))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [shipmentPhoto], lines: [{ lineId, acceptedQuantity: 46, damagedQuantity: 2 }] })
        .expect(400);
      const received = await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundId}/receive`)
        .set(as(gbOperator))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [shipmentPhoto], lines: [{ lineId, acceptedQuantity: 46, damagedQuantity: 2, damagePhotoFileIds: [damagePhoto] }] })
        .expect(200);
      expect(received.body.status).toBe("DISCREPANCY");
      expect(received.body.lines[0]).toMatchObject({ declaredQuantity: 50, acceptedQuantity: 46, damagedQuantity: 2, missingQuantity: 2, extraQuantity: 0 });
      expect(test.email.lastTo("owner@stock.example")!.subject).toContain("with differences");
      await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundId}/receive`)
        .set(as(gbOperator))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [shipmentPhoto], lines: [{ lineId, acceptedQuantity: 46, damagedQuantity: 0 }] })
        .expect(409);

      const vendorView = await test.http().get(`/v1/vendor/inbound/${inboundId}`).set(as(owner)).expect(200);
      expect(vendorView.body.photos).toHaveLength(2);
      await test.http().post(`/v1/vendor/inbound/${inboundId}/photos/${damagePhoto}/url`).set(as(owner)).expect(200);
      await test.http().post(`/v1/vendor/inbound/${inboundId}/photos/${damagePhoto}/url`).set(as(otherVendor)).expect(404);

      const product = await test.http().get(`/v1/vendor/products/${productId}`).set(as(owner)).expect(200);
      expect(product.body.stock).toEqual({ available: 46, reserved: 0, damaged: 2 });
      const boxes = await query<{ boxes: string }>("SELECT count(*) AS boxes FROM storage_boxes WHERE inbound_id = $1", [inboundId]);
      expect(Number(boxes[0]!.boxes)).toBe(2);
    });
  });

  describe("custody", () => {
    let lotId: string;

    it("puts away and moves stock, recording each step", async () => {
      const unplaced = (await test.http().get(`/v1/warehouse/warehouses/${warehouseId}/lots?unplaced=true`).set(as(gbOperator)).expect(200)).body as Array<{
        id: string;
        condition: string;
        code: string;
      }>;
      expect(unplaced).toHaveLength(2);
      const sellable = unplaced.find((lot) => lot.condition === "SELLABLE")!;
      lotId = sellable.id;
      expect(sellable.code).toMatch(/^GB-[A-F0-9]{6}-WIG-BW-16-000\d$/);
      await test.http().post(`/v1/warehouse/lots/${lotId}/location`).set(as(countryOps)).send({ locationId: locations["A-01"] }).expect(404);
      await test.http().post(`/v1/warehouse/lots/${lotId}/location`).set(as(usOperator)).send({ locationId: locations["A-01"] }).expect(404);
      const placed = await test.http().post(`/v1/warehouse/lots/${lotId}/location`).set(as(gbOperator)).send({ locationId: locations["A-01"] }).expect(200);
      expect(placed.body.locationCode).toBe("A-01");
      await test.http().post(`/v1/warehouse/lots/${lotId}/location`).set(as(gbOperator)).send({ locationId: locations["A-01"] }).expect(409);
      await test.http().post(`/v1/warehouse/lots/${lotId}/location`).set(as(gbOperator)).send({ locationId: locations["A-02"] }).expect(200);
      await test.http().post(`/v1/warehouse/warehouses/${warehouseId}/locations/${locations["A-02"]}/active`).set(as(gbOperator)).send({ active: false }).expect(409);

      const custody = (await test.http().get(`/v1/vendor/inventory/lots/${lotId}/custody`).set(as(owner)).expect(200)).body as Array<{
        type: string;
        toLocation: string | null;
        actorEmail: string | null;
      }>;
      expect(custody.map((event) => [event.type, event.toLocation])).toEqual([
        ["RECEIVED", null],
        ["PUT_AWAY", "A-01"],
        ["MOVED", "A-02"],
      ]);
      expect(custody.every((event) => event.actorEmail === null)).toBe(true);
      await test.http().get(`/v1/vendor/inventory/lots/${lotId}/custody`).set(as(otherVendor)).expect(404);
    });

    it("keeps an unbroken, append-only custody chain", async () => {
      const rows = await query<{ sequence: string; prev_hash: string; hash: string; expected: string }>(
        "SELECT sequence, prev_hash, hash, custody_event_digest(c, prev_hash) AS expected FROM custody_events c ORDER BY sequence",
      );
      expect(rows.length).toBeGreaterThanOrEqual(4);
      rows.forEach((row, index) => {
        expect(row.hash).toBe(row.expected);
        expect(row.prev_hash).toBe(index === 0 ? "0".repeat(64) : rows[index - 1]!.hash);
      });
      await expect(query("UPDATE custody_events SET quantity = 999")).rejects.toThrow(/append-only/);
      await expect(query("DELETE FROM inventory_movements")).rejects.toThrow(/append-only/);
      await expect(query("DELETE FROM inbound_photos")).rejects.toThrow(/append-only/);
    });

    it("prints product and lot labels for the right people", async () => {
      const productLabels = await test
        .http()
        .post("/v1/vendor/inventory/labels")
        .set(as(owner))
        .send({ productIds: [productId] })
        .expect(200);
      expect(productLabels.body).toEqual([{ code: "WIG-BW-16", productName: "Body wave wig 16 inch", variantLabel: null, quantity: null, barcode: "4006381333931" }]);
      const otherLabels = await test
        .http()
        .post("/v1/vendor/inventory/labels")
        .set(as(otherVendor))
        .send({ productIds: [productId] })
        .expect(200);
      expect(otherLabels.body).toEqual([]);
      const lotLabels = await test.http().get(`/v1/warehouse/inbound/${inboundId}/labels`).set(as(gbOperator)).expect(200);
      expect(lotLabels.body).toHaveLength(2);
      await test.http().get(`/v1/warehouse/inbound/${inboundId}/labels`).set(as(usOperator)).expect(404);
    });

    it("tells the vendor every stock movement", async () => {
      const movements = (await test.http().get("/v1/vendor/inventory/movements").set(as(owner)).expect(200)).body as Array<{ type: string }>;
      expect(movements.map((movement) => movement.type).sort()).toEqual(["MOVE", "PUT_AWAY", "RECEIVE", "RECEIVE"]);
    });
  });

  describe("onboarding charges", () => {
    let freshProductId: string;
    const draft = async () =>
      (
        await test
          .http()
          .post("/v1/vendor/inbound")
          .set(as(otherVendor))
          .send({ shippingMode: "LOOSE", expectedArrivalDate: inDays(3), boxCounts: { SMALL: 2 }, lines: [{ productId: freshProductId, quantity: 10 }] })
          .expect(201)
      ).body.id as string;
    const act = (id: string, action: string) => test.http().post(`/v1/vendor/inbound/${id}/actions`).set(as(otherVendor)).send({ action });

    beforeAll(async () => {
      freshProductId = (
        await test
          .http()
          .post("/v1/vendor/products")
          .set(as(otherVendor))
          .send({ ...PRODUCT, code: "FRESH-1", barcodes: [] })
          .expect(201)
      ).body.id;
      await fundWallet((await test.http().get("/v1/auth/me").set(as(otherVendor))).body.vendorId, 100_000);
    });

    it("waives the first shipment's stocking once, even when two are submitted together", async () => {
      const drafts = [await draft(), await draft()];
      const submitted = await Promise.all(drafts.map((id) => act(id, "SUBMIT")));
      expect(submitted.map((response) => response.status)).toEqual([200, 200]);
      const fees = submitted.map((response) => (response.body as { charges: { onboardingFeeMinor: number } }).charges.onboardingFeeMinor);
      expect(fees.sort()).toEqual([1800, 4200]);
      await Promise.all(drafts.map((id) => act(id, "CANCEL").expect(200)));
    });

    it("gives the waiver back when the waived shipments are cancelled", async () => {
      const next = await draft();
      const submitted = await act(next, "SUBMIT").expect(200);
      expect(submitted.body.charges.onboardingFeeMinor).toBe(1800);
      const balance = (await test.http().get("/v1/vendor/wallet").set(as(otherVendor)).expect(200)).body.balanceMinor;
      expect(balance).toBe(100_000 - 1800);
    });
  });
});
