import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import { PartnerUpkeepService } from "../src/modules/partners/jobs/partner-upkeep.service";
import type { MysteryOrderView, OrderDetailView, PartnerStatementView, ScorecardView, StockCountView } from "../src/shared";
import {
  acceptStaffInvitation,
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
} from "./harness";
import { as, GB_RECIPIENT, inDays, PartnerFlow, query } from "./partner-helpers";

describe("partner hubs at work", () => {
  let test: TestApp;
  let flow: PartnerFlow;
  let superAdmin: string;
  let complianceA: string;
  let financeA: string;
  let financeB: string;
  let owner: string;
  let vendorId: string;
  let productId: string;
  let a: { token: string; partnerId: string; hubId: string };
  let b: { token: string; partnerId: string; hubId: string };
  let c: { token: string; partnerId: string; hubId: string };
  let inboundA: string;
  let presetId: string;
  let arrivalPhoto: string;

  const statement = async (token: string) => (await test.http().get("/v1/partner/statement").set(as(token)).expect(200)).body as PartnerStatementView;
  const shipment = (warehouseId: string, quantity: number, product = productId) => ({
    warehouseId,
    shippingMode: "LOOSE",
    expectedArrivalDate: inDays(3),
    boxCounts: { SMALL: 2 },
    lines: [{ productId: product, quantity }],
  });
  const createInbound = async (warehouseId: string, quantity: number, product = productId) =>
    (
      await test
        .http()
        .post("/v1/vendor/inbound")
        .set(as(owner))
        .send(shipment(warehouseId, quantity, product))
        .expect(201)
    ).body.id as string;
  const submitInbound = (id: string) => test.http().post(`/v1/vendor/inbound/${id}/actions`).set(as(owner)).send({ action: "SUBMIT" });
  const product = async (code: string, declaredValueMinor: number, barcode: string) =>
    (
      await test
        .http()
        .post("/v1/vendor/products")
        .set(as(owner))
        .send({ code, name: `Product ${code}`, countryOfOrigin: "CN", declaredValueMinor, weightGrams: 350, storageTier: "SMALL", barcodes: [{ value: barcode, symbology: "CODE128" }] })
        .expect(201)
    ).body.id as string;

  async function packAndRate(token: string, orderId: string, barcode: string, units: number): Promise<string> {
    const staff = (path: string) => test.http().post(`/v1/warehouse/orders/${orderId}/${path}`).set(as(token));
    for (let unit = 0; unit < units; unit += 1) {
      await staff("scans").send({ code: barcode }).expect(200);
    }
    await staff("pack").send({ presetId, weightGrams: 800 }).expect(200);
    const rated = await staff("actions").send({ action: "FETCH_RATES" }).expect(200);
    await staff("actions").send({ action: "SELECT_RATE", rateId: rated.body.rates[0].id }).expect(200);
    return orderId;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    await insertLegalDocument("US", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
    flow = new PartnerFlow(test);
    const staffMember = async (email: string, role: string) => {
      await flushRateLimits();
      return createStaff(test, email, role);
    };
    superAdmin = await staffMember("super@gfn.test", "SUPER_ADMIN");
    complianceA = await staffMember("compliance-a@gfn.test", "COMPLIANCE");
    financeA = await staffMember("finance-a@gfn.test", "FINANCE_ADMIN");
    financeB = await staffMember("finance-b@gfn.test", "FINANCE_ADMIN");
    await flushRateLimits();
    owner = (await signUpAndVerify(test, "owner@hubs.example")).accessToken;
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 200_000);
    a = await flow.onboard("lead-a@partner.test", "Ada Obi", complianceA, superAdmin);
    b = await flow.onboard("lead-b@partner.test", "Bisi Ade", complianceA, superAdmin);
    c = await flow.onboard("lead-c@partner.test", "Chris Lee", complianceA, superAdmin, "US", "12-3456789");
    productId = await product("wig-1", 4_500, "WIG-1");
    presetId = (await test.http().post("/v1/admin/packaging/GB").set(as(superAdmin)).send({ code: "box-s", label: "Small box", kind: "BOX", lengthMm: 300, widthMm: 200, heightMm: 100 }).expect(201))
      .body.id;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("tier limits", () => {
    it("takes stock up to the hub's tier, then asks the vendor to choose another hub", async () => {
      inboundA = await createInbound(a.hubId, 10);
      await submitInbound(inboundA).expect(200);
      const over = await createInbound(a.hubId, 2);
      const refused = await submitInbound(over).expect(409);
      expect(refused.body.message).toBe("This hub can hold stock worth £50.00 more right now. Send fewer units or choose another hub.");
      const pricey = await product("watch-1", 15_000, "WATCH-1");
      const valuable = await createInbound(a.hubId, 1, pricey);
      const tooValuable = await submitInbound(valuable).expect(409);
      expect(tooValuable.body.message).toMatch(/items worth up to £100.00 each/);
      await submitInbound(await createInbound(b.hubId, 2)).expect(200);
    });
  });

  describe("isolation between hubs", () => {
    it("shows each partner only its own hub's inbound and stock", async () => {
      const queueA = (await test.http().get("/v1/warehouse/inbound").set(as(a.token)).expect(200)).body as Array<{ id: string }>;
      expect(queueA.map((entry) => entry.id)).toEqual([inboundA]);
      await test.http().get(`/v1/warehouse/inbound/${inboundA}`).set(as(b.token)).expect(404);
      await test.http().get(`/v1/warehouse/warehouses/${a.hubId}`).set(as(b.token)).expect(404);
      await test.http().get(`/v1/warehouse/warehouses/${a.hubId}/lots`).set(as(c.token)).expect(404);
      expect((await test.http().get("/v1/warehouse/inbound").set(as(c.token)).expect(200)).body).toEqual([]);
    });

    it("hides what vendors pay from partners", async () => {
      const detail = await test.http().get(`/v1/warehouse/inbound/${inboundA}`).set(as(a.token)).expect(200);
      expect(detail.body.charges).toMatchObject({ onboardingFeeMinor: null, holdChargeMinor: null });
      expect(detail.body.actions).not.toContain("REJECT");
    });

    it("leaves charges, refusals and returns to the platform", async () => {
      const act = (body: object) => test.http().post(`/v1/warehouse/inbound/${inboundA}/actions`).set(as(a.token)).send(body);
      await act({ action: "HOLD", reason: "Boxes arrived wet and crushed.", chargeMinor: 5_000 }).expect(403);
      await act({ action: "REJECT", reason: "Boxes arrived wet and crushed." }).expect(403);
      await act({ action: "REQUEST_RETURN", reason: "Boxes arrived wet and crushed." }).expect(403);
    });
  });

  describe("earning from the work", () => {
    it("pays a share of receiving and first-month storage, with the founding bonus and part held back", async () => {
      await test.http().post(`/v1/warehouse/inbound/${inboundA}/actions`).set(as(a.token)).send({ action: "CHECK_IN" }).expect(200);
      const detail = await test.http().get(`/v1/warehouse/inbound/${inboundA}`).set(as(a.token)).expect(200);
      const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
      const lines = [{ lineId: detail.body.lines[0].id, acceptedQuantity: 10, damagedQuantity: 0 }];
      const inflated = await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundA}/receive`)
        .set(as(a.token))
        .send({ boxCounts: { SMALL: 2, LARGE: 40 }, photoFileIds: [photo], lines })
        .expect(400);
      expect(inflated.body.fieldErrors.boxCounts[0]).toMatch(/more boxes than the vendor declared/);
      const extraUnits = [{ ...lines[0]!, acceptedQuantity: 11 }];
      const tooMany = await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundA}/receive`)
        .set(as(a.token))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [photo], lines: extraUnits })
        .expect(400);
      expect(tooMany.body.fieldErrors.lines[0]).toMatch(/more units than the vendor declared/);
      arrivalPhoto = photo;
      await test
        .http()
        .post(`/v1/warehouse/inbound/${inboundA}/receive`)
        .set(as(a.token))
        .send({ boxCounts: { SMALL: 2 }, photoFileIds: [photo], lines })
        .expect(200);
      const earned = await statement(a.token);
      expect(earned).toMatchObject({ currency: "GBP", availableMinor: 2_520, heldMinor: 630, earnedMinor: 3_150 });
    });

    it("needs a dispatch photo before paying for an order", async () => {
      const placed = await test
        .http()
        .post("/v1/vendor/orders")
        .set(as(owner))
        .send({ warehouseId: a.hubId, deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 2 }] }] })
        .expect(201);
      const orderId = await packAndRate(a.token, placed.body[0].id as string, "WIG-1", 2);
      const rated = (await test.http().get(`/v1/warehouse/orders/${orderId}`).set(as(a.token)).expect(200)).body as OrderDetailView;
      expect(rated.charges).toBeNull();
      expect(rated.rates.every((rate) => rate.chargeMinor === null)).toBe(true);
      await test.http().post(`/v1/warehouse/orders/${orderId}/actions`).set(as(a.token)).send({ action: "HAND_OFF" }).expect(400);
      await test
        .http()
        .post(`/v1/warehouse/orders/${orderId}/actions`)
        .set(as(a.token))
        .send({ action: "HAND_OFF", photoFileIds: [arrivalPhoto] })
        .expect(400);
      const foreign = await uploadVerifiedFile(test, b.token, "EVIDENCE_PHOTO");
      await test
        .http()
        .post(`/v1/warehouse/orders/${orderId}/actions`)
        .set(as(a.token))
        .send({ action: "HAND_OFF", photoFileIds: [foreign] })
        .expect(400);
      const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
      const handed = await test
        .http()
        .post(`/v1/warehouse/orders/${orderId}/actions`)
        .set(as(a.token))
        .send({ action: "HAND_OFF", photoFileIds: [photo] })
        .expect(200);
      expect(handed.body).toMatchObject({ status: "HANDED_OFF", dispatchPhotoCount: 1 });
      expect(await statement(a.token)).toMatchObject({ availableMinor: 2_520 + 239, heldMinor: 630 + 59 });
    });

    it("holds the pay for an order shipped without a photo until one is added", async () => {
      const placed = await test
        .http()
        .post("/v1/vendor/orders")
        .set(as(owner))
        .send({ warehouseId: a.hubId, deliveries: [{ recipient: GB_RECIPIENT, lines: [{ productId, quantity: 1 }] }] })
        .expect(201);
      const orderId = await packAndRate(a.token, placed.body[0].id as string, "WIG-1", 1);
      await test.http().post(`/v1/warehouse/orders/${orderId}/sandbox-tracking`).set(as(superAdmin)).send({ status: "IN_TRANSIT", description: "Collected by carrier" }).expect(200);
      const before = await statement(a.token);
      expect(before.awaitingEvidence.map((entry) => entry.orderId)).toEqual([orderId]);
      const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
      await test
        .http()
        .post(`/v1/warehouse/orders/${orderId}/dispatch-photos`)
        .set(as(a.token))
        .send({ fileIds: [photo] })
        .expect(200);
      await test
        .http()
        .post(`/v1/warehouse/orders/${orderId}/dispatch-photos`)
        .set(as(a.token))
        .send({ fileIds: [photo] })
        .expect(400);
      const after = await statement(a.token);
      expect(after.awaitingEvidence).toEqual([]);
      expect(after.availableMinor + after.heldMinor - before.availableMinor - before.heldMinor).toBe(224);
    });
  });

  describe("stock counts", () => {
    let countId: string;
    let countVideo: string;

    it("asks for a blind count with video, and flags differences automatically", async () => {
      await test.http().post(`/v1/admin/partners/${a.partnerId}/stock-counts`).set(as(a.token)).send({}).expect(404);
      const requested = (await test.http().post(`/v1/admin/partners/${a.partnerId}/stock-counts`).set(as(complianceA)).send({ lines: 5, dueInHours: 24 }).expect(201)).body as StockCountView;
      countId = requested.id;
      expect(test.email.lastTo("lead-a@partner.test")!.subject).toBe("Please count some stock for us");
      await test.http().post(`/v1/admin/partners/${a.partnerId}/stock-counts`).set(as(complianceA)).send({}).expect(409);
      const hubView = (await test.http().get("/v1/warehouse/stock-counts").set(as(a.token)).expect(200)).body as StockCountView[];
      const countedCodes = hubView[0]!.lines.map((line) => line.lotCode);
      const lotCodes = async (token: string) => (await test.http().get(`/v1/warehouse/warehouses/${a.hubId}/lots`).set(as(token)).expect(200)).body as Array<{ id: string; code: string }>;
      expect((await lotCodes(a.token)).some((lot) => countedCodes.includes(lot.code))).toBe(false);
      const hiddenLot = (await lotCodes(superAdmin)).find((lot) => countedCodes.includes(lot.code))!;
      await test.http().get(`/v1/warehouse/lots/${hiddenLot.id}/custody`).set(as(a.token)).expect(404);
      expect(hubView[0]!.lines.every((line) => line.expectedQuantity === null)).toBe(true);
      expect((await test.http().get("/v1/warehouse/stock-counts").set(as(b.token)).expect(200)).body).toEqual([]);
      const [video] = await flow.files(a.token, 1, "STOCK_COUNT");
      countVideo = video!;
      const lines = hubView[0]!.lines.map((line) => ({ lineId: line.id, countedQuantity: 5 }));
      await test.http().post(`/v1/warehouse/stock-counts/${countId}/submit`).set(as(b.token)).send({ videoFileId: video, lines }).expect(404);
      const submitted = await test.http().post(`/v1/warehouse/stock-counts/${countId}/submit`).set(as(a.token)).send({ videoFileId: video, lines }).expect(200);
      expect(submitted.body).toMatchObject({ status: "FLAGGED", mismatchedLines: 0 });
      expect((await lotCodes(a.token)).some((lot) => countedCodes.includes(lot.code))).toBe(true);
      const adminView = (await test.http().get(`/v1/admin/stock-counts/${countId}`).set(as(complianceA)).expect(200)).body as StockCountView;
      expect(adminView).toMatchObject({ status: "FLAGGED", mismatchedLines: 1 });
      expect(adminView.lines[0]).toMatchObject({ expectedQuantity: 7, countedQuantity: 5 });
      await test.http().get(`/v1/admin/partners/${a.partnerId}/files/${video}`).set(as(complianceA)).expect(200);
    });

    it("marks counts not sent in time as missed, and needs someone to resolve them", async () => {
      await test.http().post(`/v1/admin/stock-counts/${countId}/resolve`).set(as(complianceA)).send({ note: "Two units found in the returns tray." }).expect(200);
      await test.http().post(`/v1/admin/stock-counts/${countId}/resolve`).set(as(complianceA)).send({ note: "Resolving it a second time." }).expect(409);
      const again = (await test.http().post(`/v1/admin/partners/${a.partnerId}/stock-counts`).set(as(complianceA)).send({ lines: 1 }).expect(201)).body as StockCountView;
      const reused = await test
        .http()
        .post(`/v1/warehouse/stock-counts/${again.id}/submit`)
        .set(as(a.token))
        .send({ videoFileId: countVideo, lines: again.lines.map((line) => ({ lineId: line.id, countedQuantity: 1 })) })
        .expect(400);
      expect(reused.body.fieldErrors.videoFileId[0]).toBe("Film a new video for each count");
      const empty = await test.http().post(`/v1/admin/partners/${b.partnerId}/stock-counts`).set(as(complianceA)).send({ dueInHours: 12 }).expect(409);
      expect(empty.body.message).toBe("There's no stock at this hub to count.");
      await seedStock({ vendorId, productId, warehouseId: b.hubId, quantity: 4 });
      const late = (await test.http().post(`/v1/admin/partners/${b.partnerId}/stock-counts`).set(as(complianceA)).send({ dueInHours: 12 }).expect(201)).body as StockCountView;
      await query("UPDATE stock_counts SET due_at = now() - interval '1 hour' WHERE id = $1", [late.id]);
      expect(await test.app.get(PartnerUpkeepService).run()).toMatchObject({ countsMissed: 1 });
      expect((await test.http().get(`/v1/admin/stock-counts/${late.id}`).set(as(complianceA)).expect(200)).body.status).toBe("MISSED");
    });
  });

  describe("mystery orders", () => {
    let mysteryOrder: string;

    it("needs the country's test vendor before creating one", async () => {
      const request = { productId, quantity: 1, recipient: GB_RECIPIENT };
      const missing = await test.http().post(`/v1/admin/partners/${a.partnerId}/mystery-orders`).set(as(superAdmin)).send(request).expect(409);
      expect(missing.body.message).toMatch(/test vendor/);
      await test.http().post(`/v1/admin/partners/${a.partnerId}/mystery-orders`).set(as(complianceA)).send(request).expect(404);
    });

    it("places a test order that looks like any other, then records the result", async () => {
      const tester = (await signUpAndVerify(test, "tester@gfn.example")).accessToken;
      const testerVendor = (await test.http().get("/v1/auth/me").set(as(tester))).body.vendorId as string;
      await makeVendorTrade(testerVendor);
      await fundWallet(testerVendor, 50_000);
      const testerProduct = (
        await test
          .http()
          .post("/v1/vendor/products")
          .set(as(tester))
          .send({ code: "test-1", name: "Test item", countryOfOrigin: "GB", declaredValueMinor: 500, weightGrams: 200, storageTier: "SMALL", barcodes: [{ value: "TEST-1", symbology: "CODE128" }] })
          .expect(201)
      ).body.id as string;
      await seedStock({ vendorId: testerVendor, productId: testerProduct, warehouseId: a.hubId, quantity: 3 });
      const gb = (await test.http().get("/v1/admin/countries/GB").set(as(superAdmin)).expect(200)).body as { config: { partners: object } };
      const pointAt = (vendor: string) =>
        test
          .http()
          .patch("/v1/admin/countries/GB")
          .set(as(superAdmin))
          .send({ config: { ...gb.config, partners: { ...gb.config.partners, mysteryVendorId: vendor } } });
      await pointAt(vendorId).expect(400);
      await query("UPDATE countries SET config = jsonb_set(config, '{partners,mysteryVendorId}', to_jsonb($1::text)) WHERE code = 'GB'", [vendorId]);
      await test.http().post(`/v1/admin/partners/${a.partnerId}/mystery-orders`).set(as(superAdmin)).send({ productId, quantity: 1, recipient: GB_RECIPIENT }).expect(409);
      await query("UPDATE vendors SET is_test_account = true WHERE id = $1", [testerVendor]);
      await pointAt(testerVendor).expect(200);
      const stocked = await test.http().get(`/v1/admin/partners/${a.partnerId}/mystery-orders/products`).set(as(superAdmin)).expect(200);
      expect(stocked.body).toEqual([{ productId: testerProduct, code: "TEST-1", name: "Test item", available: 3 }]);
      await test.http().get(`/v1/admin/partners/${a.partnerId}/mystery-orders/products`).set(as(complianceA)).expect(404);
      const created = (
        await test.http().post(`/v1/admin/partners/${a.partnerId}/mystery-orders`).set(as(superAdmin)).send({ productId: testerProduct, quantity: 1, recipient: GB_RECIPIENT }).expect(201)
      ).body as MysteryOrderView;
      mysteryOrder = created.orderId;
      const seen = (await test.http().get(`/v1/warehouse/orders/${mysteryOrder}`).set(as(a.token)).expect(200)).body;
      expect(JSON.stringify(seen)).not.toMatch(/mystery|test vendor/i);
      await test.http().post(`/v1/admin/mystery-orders/${mysteryOrder}/assessment`).set(as(complianceA)).send({ passed: true, note: "Too early to judge this." }).expect(409);
      await packAndRate(a.token, mysteryOrder, "TEST-1", 1);
      const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
      await test.http().post(`/v1/admin/mystery-orders/${mysteryOrder}/assessment`).set(as(superAdmin)).send({ passed: true, note: "Checking my own test order." }).expect(403);
      await test
        .http()
        .post(`/v1/warehouse/orders/${mysteryOrder}/actions`)
        .set(as(a.token))
        .send({ action: "HAND_OFF", photoFileIds: [photo] })
        .expect(200);
      const assessed = await test
        .http()
        .post(`/v1/admin/mystery-orders/${mysteryOrder}/assessment`)
        .set(as(complianceA))
        .send({ passed: true, note: "Right item, well packed, sent the same day." })
        .expect(200);
      expect(assessed.body).toMatchObject({ outcome: "PASSED" });
    });
  });

  describe("scorecard and tiers", () => {
    it("scores accuracy, speed, losses and evidence, and holds promotion after a flagged count", async () => {
      const scorecard = (await test.http().get("/v1/partner/scorecard").set(as(a.token)).expect(200)).body as ScorecardView;
      expect(scorecard).toMatchObject({ ordersShipped: 3, cleanOrders: 3, evidenceCompliancePct: 100, countsFlagged: 1, countAccuracyPct: 0, mysteryPassed: null, shortUnits: 2, lossRatePct: 20 });
      expect(scorecard.nextTier).toMatchObject({ level: 2, name: "Trusted", ordersNeeded: 47, countsNeeded: 2, blocked: "A stock count was flagged or missed recently" });
      await test.http().get("/v1/partner/scorecard").set(as(complianceA)).expect(404);
      const internal = (await test.http().get(`/v1/admin/partners/${a.partnerId}/scorecard`).set(as(complianceA)).expect(200)).body as ScorecardView;
      expect(internal).toMatchObject({ mysteryPassed: 1, mysteryFailed: 0 });
    });

    it("lets a partner manager change the tier with a reason", async () => {
      await test.http().put(`/v1/admin/partners/${b.partnerId}/tier`).set(as(complianceA)).send({ level: 2, reason: "Trusted community member." }).expect(404);
      await test.http().put(`/v1/admin/partners/${b.partnerId}/tier`).set(as(superAdmin)).send({ level: 9, reason: "Trusted community member." }).expect(400);
      const raised = await test.http().put(`/v1/admin/partners/${b.partnerId}/tier`).set(as(superAdmin)).send({ level: 2, reason: "Trusted community member." }).expect(200);
      expect(raised.body).toMatchObject({ tierLevel: 2, tier: { name: "Trusted", maxStockValueMinor: 300_000 } });
    });
  });

  describe("payouts", () => {
    it("sends approved payouts through the payout provider, with a second approver", async () => {
      const { availableMinor } = await statement(a.token);
      await test
        .http()
        .post(`/v1/admin/partners/${a.partnerId}/payouts`)
        .set(as(financeA))
        .send({ amountMinor: availableMinor + 1, note: "Monthly payout" })
        .expect(400);
      const requested = await test.http().post(`/v1/admin/partners/${a.partnerId}/payouts`).set(as(financeA)).send({ amountMinor: 1_000, note: "Monthly payout" }).expect(201);
      await test.http().post(`/v1/admin/partner-payouts/${requested.body.id}/decision`).set(as(financeA)).send({ approve: true, note: "Approving my own" }).expect(403);
      const paid = await test.http().post(`/v1/admin/partner-payouts/${requested.body.id}/decision`).set(as(financeB)).send({ approve: true, note: "Checked against the statement" }).expect(201);
      expect(paid.body).toMatchObject({ status: "PAID", decidedByEmail: "finance-b@gfn.test" });
      const [row] = await query<{ provider_transfer_id: string }>("SELECT provider_transfer_id FROM partner_payouts WHERE id = $1", [requested.body.id]);
      expect(row!.provider_transfer_id).toMatch(/^practice_tr_/);
      expect((await statement(a.token)).availableMinor).toBe(availableMinor - 1_000);
      expect(test.email.lastTo("lead-a@partner.test")!.subject).toBe("Payout of £10.00 sent");
    });

    it("won't pay to bank details changed after the request", async () => {
      const requested = await test.http().post(`/v1/admin/partners/${a.partnerId}/payouts`).set(as(financeA)).send({ amountMinor: 100, note: "Top-up payout" }).expect(201);
      await query("UPDATE partner_payout_accounts SET details_changed_at = now() + interval '1 second' WHERE partner_id = $1", [a.partnerId]);
      await test.http().post(`/v1/admin/partner-payouts/${requested.body.id}/decision`).set(as(financeB)).send({ approve: true, note: "Approving the payout" }).expect(409);
      await test.http().post(`/v1/admin/partner-payouts/${requested.body.id}/decision`).set(as(financeB)).send({ approve: false, note: "Details changed, request again" }).expect(201);
    });

    it("keeps the ledger append-only and never negative", async () => {
      await expect(query("UPDATE partner_ledger_entries SET amount_minor = 1 WHERE partner_id = $1", [a.partnerId])).rejects.toThrow();
      await expect(
        query(
          "INSERT INTO partner_ledger_entries (partner_id, currency, type, bucket, amount_minor, description, idempotency_key) VALUES ($1, 'GBP', 'ADJUSTMENT', 'AVAILABLE', -100000000, 'Overdraw', 'overdraw')",
          [a.partnerId],
        ),
      ).rejects.toThrow(/below zero/);
    });
  });

  describe("the partner's team", () => {
    it("lets the lead add team members who can work the hub but not see the partnership", async () => {
      await test.http().post("/v1/partner/team/invitations").set(as(a.token)).send({ email: "helper@partner.test" }).expect(202);
      const helper = await acceptStaffInvitation(test, "helper@partner.test");
      expect(((await test.http().get("/v1/warehouse/warehouses").set(as(helper)).expect(200)).body as Array<{ id: string }>).map((warehouse) => warehouse.id)).toEqual([a.hubId]);
      const limited = await flow.overview(helper);
      expect(limited).toMatchObject({ payoutAccount: null, team: [], agreements: [], profile: null });
      await test.http().get("/v1/partner/statement").set(as(helper)).expect(404);
      await test.http().get("/v1/partner/scorecard").set(as(helper)).expect(404);
      await test.http().post("/v1/partner/payouts/setup").set(as(helper)).expect(404);
    });
  });
});
