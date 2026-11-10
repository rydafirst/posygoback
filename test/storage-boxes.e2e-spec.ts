import { StorageBillingService } from "../src/modules/finance/jobs/storage-billing.service";
import type { HubRepackListView, VendorBoxesView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile } from "./harness";
import { as, inDays, query } from "./partner-helpers";

const PRODUCT = { code: "serum-30", name: "Face serum 30ml", countryOfOrigin: "NG", declaredValueMinor: 1500, weightGrams: 80, storageTier: "SMALL", barcodes: [{ value: "SERUM-30", symbology: "CODE128" }] };

describe("storage boxes from arrival to empty", () => {
  let test: TestApp;
  let owner: string;
  let operator: string;
  let vendorId: string;
  let productId: string;
  let warehouseId: string;

  const http = () => test.http();
  const balance = async () => (await http().get("/v1/vendor/wallet").set(as(owner)).expect(200)).body.balanceMinor as number;
  const vendorBoxes = async () => (await http().get("/v1/vendor/inventory/boxes").set(as(owner)).expect(200)).body as VendorBoxesView;
  const hubBoxes = async () => (await http().get(`/v1/warehouse/warehouses/${warehouseId}/boxes`).set(as(operator)).expect(200)).body as HubRepackListView;

  async function sendAndReceive(shippingMode: string, declared: Record<string, number>, received: Record<string, number>, units: number): Promise<void> {
    const inbound = (await http().post("/v1/vendor/inbound").set(as(owner)).send({ shippingMode, expectedArrivalDate: inDays(3), boxCounts: declared, lines: [{ productId, quantity: units }] }).expect(201)).body;
    await http().post(`/v1/vendor/inbound/${inbound.id}/actions`).set(as(owner)).send({ action: "SUBMIT" }).expect(200);
    await http().post(`/v1/warehouse/inbound/${inbound.id}/actions`).set(as(operator)).send({ action: "CHECK_IN" }).expect(200);
    const detail = (await http().get(`/v1/warehouse/inbound/${inbound.id}`).set(as(operator)).expect(200)).body;
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    await http()
      .post(`/v1/warehouse/inbound/${inbound.id}/receive`)
      .set(as(operator))
      .send({ boxCounts: received, photoFileIds: [photo], lines: [{ lineId: detail.lines[0].id, acceptedQuantity: units, damagedQuantity: 0 }] })
      .expect(200);
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@serums.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner)).expect(200)).body.vendorId as string;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 100_000);
    operator = await createStaff(test, "operator-gb@gfn.test", "WAREHOUSE_OPERATOR", "GB");
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    await http()
      .post("/v1/warehouse/warehouses")
      .set(as(superAdmin))
      .send({ countryCode: "GB", code: "man-1", name: "Manchester", addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
      .expect(201);
    productId = (await http().post("/v1/vendor/products").set(as(owner)).send(PRODUCT).expect(201)).body.id as string;
    warehouseId = (await http().get("/v1/vendor/inbound/hubs").set(as(owner)).expect(200)).body[0].warehouseId as string;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("boxes up small packets in Posygo boxes, and refunds boxes that weren't needed", async () => {
    const before = await balance();
    await sendAndReceive("POSYGO_BOXES", { SMALL: 2 }, { SMALL: 1 }, 40);
    expect(before - (await balance())).toBe(900);
    expect(await vendorBoxes()).toMatchObject({ currency: "GBP", monthlyMinor: 900, hubs: [{ boxes: [{ tier: "SMALL", count: 1, supplied: 1, monthlyMinor: 900 }], unitsStored: 40 }] });
  });

  it("lets the hub repack into fewer boxes with a photo, but never into dearer ones", async () => {
    await sendAndReceive("LOOSE", { MEDIUM: 1, SMALL: 1 }, { MEDIUM: 1, SMALL: 1 }, 10);
    expect((await hubBoxes()).vendors).toEqual([expect.objectContaining({ vendorId, monthlyMinor: 900 + 900 + 1400, unitsStored: 50 })]);
    const photo = await uploadVerifiedFile(test, operator, "EVIDENCE_PHOTO");
    const repack = (boxCounts: Record<string, number>, photoFileIds = [photo]) => http().post(`/v1/warehouse/warehouses/${warehouseId}/boxes/repack`).set(as(operator)).send({ vendorId, boxCounts, photoFileIds });
    await repack({ LARGE: 2 }).expect(400);
    await repack({ MEDIUM: 1 }, []).expect(400);
    const repacked = (await repack({ MEDIUM: 1 }).expect(200)).body as HubRepackListView;
    expect(repacked.vendors[0]).toMatchObject({ monthlyMinor: 1400, boxes: [{ tier: "MEDIUM", count: 1 }] });
    expect((await vendorBoxes()).monthlyMinor).toBe(1400);
    const [notice] = await query<{ body: string }>("SELECT body FROM notifications WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1", [vendorId]);
    expect(notice!.body).toContain("drops from £32.00 to £14.00");
  });

  it("stops charging once the seller has nothing left at the hub", async () => {
    await query("UPDATE stock_lots SET quantity_available = 0, quantity_reserved = 0 WHERE vendor_id = $1", [vendorId]).catch(() => undefined);
    const [left] = await query<{ units: string }>("SELECT sum(quantity_available + quantity_reserved) AS units FROM stock_lots WHERE vendor_id = $1", [vendorId]);
    expect(Number(left!.units)).toBe(0);
    const before = await balance();
    const nextMonth = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    await test.app.get(StorageBillingService).run(new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), nextMonth.getUTCDate())));
    expect(await balance()).toBe(before);
    expect(await vendorBoxes()).toEqual({ currency: "GBP", hubs: [], monthlyMinor: 0 });
    const reasons = await query<{ closed_reason: string }>("SELECT DISTINCT closed_reason FROM storage_boxes WHERE vendor_id = $1 ORDER BY closed_reason", [vendorId]);
    expect(reasons.map((row) => row.closed_reason)).toEqual(["EMPTY", "REPACKED"]);
  });
});
