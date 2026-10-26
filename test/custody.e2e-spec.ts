import { anchorKey, AuditAnchorService } from "../src/modules/audit-anchor/audit-anchor.service";
import { CustodyUpkeepService } from "../src/modules/partners/jobs/custody-upkeep.service";
import type { ClaimView, CustodyAlertView, HubSignalView, PartnerDetailView, StockCountView, TransferView, TrustView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";

describe("custody, claims and trust", () => {
  let test: TestApp;
  let superAdmin: string;
  let compliance: string;
  let financeA: string;
  let financeB: string;
  let opsGB: string;
  let opsUS: string;
  let owner: string;
  let vendorId: string;
  let lotId: string;
  let transferId: string;
  let transferClaimId: string;
  let a: { token: string; partnerId: string; hubId: string };
  let b: { token: string; partnerId: string; hubId: string };

  const get = async <T>(token: string, path: string, status = 200) => (await test.http().get(path).set(as(token)).expect(status)).body as T;
  const post = (token: string, path: string, body: object = {}) => test.http().post(path).set(as(token)).send(body);
  const lot = async () =>
    (await query<{ warehouse_id: string; quantity_available: number; location_id: string | null }>("SELECT warehouse_id, quantity_available, location_id FROM stock_lots WHERE id = $1", [lotId]))[0]!;
  const setRule = (rule: string, value: number) => query(`UPDATE countries SET config = jsonb_set(config, '{partners,${rule}}', to_jsonb($1::int)) WHERE code = 'GB'`, [value]);

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    const flow = new PartnerFlow(test);
    const staff = async (email: string, role: string, country: string | null = null) => {
      await flushRateLimits();
      return createStaff(test, email, role, country);
    };
    superAdmin = await staff("super@gfn.test", "SUPER_ADMIN");
    compliance = await staff("compliance@gfn.test", "COMPLIANCE");
    financeA = await staff("finance-a@gfn.test", "FINANCE_ADMIN");
    financeB = await staff("finance-b@gfn.test", "FINANCE_ADMIN");
    opsGB = await staff("ops-gb@gfn.test", "COUNTRY_OPS", "GB");
    opsUS = await staff("ops-us@gfn.test", "COUNTRY_OPS", "US");
    await flushRateLimits();
    owner = (await signUpAndVerify(test, "owner@custody.example")).accessToken;
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    a = await flow.onboard("lead-a@partner.test", "Ada Obi", compliance, superAdmin);
    b = await flow.onboard("lead-b@partner.test", "Bisi Ade", compliance, superAdmin);
    const product = await post(owner, "/v1/vendor/products", {
      code: "wig-1",
      name: "Lace wig",
      countryOfOrigin: "CN",
      declaredValueMinor: 4_500,
      weightGrams: 350,
      storageTier: "SMALL",
      barcodes: [{ value: "WIG-1", symbology: "CODE128" }],
    }).expect(201);
    lotId = await seedStock({ vendorId, productId: product.body.id, warehouseId: a.hubId, quantity: 6 });
    const recorded = await post(financeA, `/v1/admin/partners/${a.partnerId}/securities`, { kind: "DEPOSIT", amountMinor: 3_000, reference: "BACS 2026-10-20" }).expect(201);
    await post(financeB, `/v1/admin/partners/${a.partnerId}/securities/${(recorded.body as PartnerDetailView).securities[0]!.id}/confirm`).expect(201);
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("moving stock between hubs", () => {
    it("lets country ops ask a hub to send its stock, only within their own country", async () => {
      const request = { fromWarehouseId: a.hubId, toWarehouseId: b.hubId, reason: "Rebalancing stock closer to the vendor's buyers." };
      await post(opsUS, "/v1/admin/transfers", request).expect(404);
      const created = (await post(opsGB, "/v1/admin/transfers", request).expect(201)).body as TransferView;
      transferId = created.id;
      expect(created).toMatchObject({ status: "REQUESTED", units: 6, actions: ["CANCEL"], lines: [{ lotId, quantitySent: 6 }] });
      expect(test.email.lastTo("lead-a@partner.test")!.subject).toMatch(/Please send stock/);
      expect(await get<TransferView[]>(b.token, "/v1/partner/transfers")).toEqual([]);
      expect((await get<TransferView[]>(a.token, "/v1/partner/transfers"))[0]!.actions).toEqual(["DISPATCH"]);
      const again = await post(opsGB, "/v1/admin/transfers", request).expect(409);
      expect(again.body.message).toBe("There's no free stock to move from there.");
    });

    it("needs a sealed, photographed dispatch from the sending hub and hides the count from the receiver", async () => {
      const dispatch = { carrier: "DPD", trackingNumber: "DPD123456", sealNumber: "SEAL-77" };
      const otherPhoto = await uploadVerifiedFile(test, b.token, "EVIDENCE_PHOTO");
      await post(b.token, `/v1/partner/transfers/${transferId}/dispatch`, { ...dispatch, photoFileIds: [otherPhoto] }).expect(404);
      await post(a.token, `/v1/partner/transfers/${transferId}/dispatch`, { ...dispatch, photoFileIds: [] }).expect(400);
      await post(a.token, `/v1/partner/transfers/${transferId}/dispatch`, { ...dispatch, photoFileIds: [otherPhoto] }).expect(400);
      const photo = await uploadVerifiedFile(test, a.token, "EVIDENCE_PHOTO");
      const sent = (await post(a.token, `/v1/partner/transfers/${transferId}/dispatch`, { ...dispatch, photoFileIds: [photo] }).expect(200)).body as TransferView;
      expect(sent).toMatchObject({ status: "DISPATCHED", sealNumber: "SEAL-77" });
      expect((await lot()).quantity_available).toBe(0);
      const incoming = await get<TransferView>(b.token, `/v1/partner/transfers/${transferId}`);
      expect(incoming).toMatchObject({ units: null, actions: ["RECEIVE"], lines: [{ quantitySent: null }] });
      await post(a.token, `/v1/partner/transfers/${transferId}/receive`, { lines: [{ lineId: incoming.lines[0]!.id, quantityReceived: 6 }] }).expect(409);
    });

    it("receives what arrived and opens a claim against the sender for what didn't", async () => {
      const lineId = (await get<TransferView>(b.token, `/v1/partner/transfers/${transferId}`)).lines[0]!.id;
      await post(b.token, `/v1/partner/transfers/${transferId}/receive`, { lines: [{ lineId, quantityReceived: 7 }] }).expect(400);
      const received = (await post(b.token, `/v1/partner/transfers/${transferId}/receive`, { lines: [{ lineId, quantityReceived: 5 }] }).expect(200)).body as TransferView;
      expect(received).toMatchObject({ status: "RECEIVED", lines: [{ quantitySent: 6, quantityReceived: 5 }] });
      expect(await lot()).toMatchObject({ warehouse_id: b.hubId, quantity_available: 5, location_id: null });
      const movements = await query<{ type: string }>("SELECT type::text FROM inventory_movements WHERE lot_id = $1 ORDER BY created_at", [lotId]);
      expect(movements.map((movement) => movement.type)).toEqual(["TRANSFER_OUT", "TRANSFER_IN"]);
      const claims = await query<{ id: string; quantity: number; partner_id: string; source: string; status: string }>(
        "SELECT id, quantity, partner_id, source::text, status::text FROM custody_claims WHERE transfer_id = $1",
        [transferId],
      );
      expect(claims).toEqual([expect.objectContaining({ quantity: 1, partner_id: a.partnerId, source: "TRANSFER", status: "OPEN" })]);
      transferClaimId = claims[0]!.id;
    });
  });

  describe("claims", () => {
    it("shows each side only what it should see", async () => {
      const vendorClaims = await get<ClaimView[]>(owner, "/v1/vendor/claims");
      expect(vendorClaims).toEqual([expect.objectContaining({ id: transferClaimId, kind: "SHORTAGE", partnerName: null, evidenceFileIds: [], platformCoverMinor: 0 })]);
      expect(await get<ClaimView[]>(a.token, "/v1/partner/claims")).toEqual([]);
      expect(await get<ClaimView[]>(opsUS, "/v1/admin/claims")).toEqual([]);
      expect((await get<ClaimView[]>(opsGB, "/v1/admin/claims"))[0]).toMatchObject({ partnerName: expect.any(String), amountMinor: 4_500 });
      await get(a.token, "/v1/admin/claims", 404);
      await get(owner, `/v1/partner/claims/${transferClaimId}`, 404);
    });

    it("keeps assessing and deciding in different hands, and recovers from the partner's deposit", async () => {
      await post(opsGB, `/v1/admin/claims/${transferClaimId}/assessment`, { liability: "PARTNER", amountMinor: 9_000, writeOff: false, note: "The seal was intact on arrival." }).expect(400);
      const assessed = await post(opsGB, `/v1/admin/claims/${transferClaimId}/assessment`, { liability: "PARTNER", amountMinor: 4_500, writeOff: false, note: "The hub packed five, not six." }).expect(
        200,
      );
      expect(assessed.body.status).toBe("ASSESSED");
      expect(test.email.lastTo("lead-a@partner.test")!.subject).toMatch(/Please respond to claim/);
      await post(b.token, `/v1/partner/claims/${transferClaimId}/response`, { response: "Not our hub, we only received it." }).expect(404);
      await post(a.token, `/v1/partner/claims/${transferClaimId}/response`, { response: "We counted six before sealing the box." }).expect(200);
      await post(a.token, `/v1/partner/claims/${transferClaimId}/response`, { response: "Adding a second thought here." }).expect(409);
      await post(opsGB, `/v1/admin/claims/${transferClaimId}/decision`, { approve: true, note: "Agreed." }).expect(404);
      const settled = (await post(financeA, `/v1/admin/claims/${transferClaimId}/decision`, { approve: true, note: "Pay the vendor." }).expect(200)).body as ClaimView;
      expect(settled).toMatchObject({
        status: "SETTLED",
        compensationMinor: 4_500,
        recoveredLedgerMinor: 0,
        recoveredDepositMinor: 3_000,
        platformCoverMinor: 1_500,
        partnerResponse: expect.any(String),
      });
      await post(financeB, `/v1/admin/claims/${transferClaimId}/decision`, { approve: true, note: "Again." }).expect(409);
      const credit = await query<{ amount_minor: string }>("SELECT amount_minor FROM ledger_entries WHERE vendor_id = $1 AND type = 'COMPENSATION'", [vendorId]);
      expect(credit.map((entry) => Number(entry.amount_minor))).toEqual([4_500]);
      expect((await get<PartnerDetailView>(a.token, "/v1/partner")).securities[0]).toMatchObject({ amountMinor: 3_000, drawnMinor: 3_000 });
      expect(test.email.lastTo("owner@custody.example")!.subject).toMatch(/has been settled/);
      const partnerView = (await get<ClaimView[]>(a.token, "/v1/partner/claims"))[0]!;
      expect(partnerView).toMatchObject({ vendorName: null, recoveredDepositMinor: 3_000, platformCoverMinor: 0 });
    });

    it("lets vendors report damaged stock once, with photos they uploaded", async () => {
      const foreign = await uploadVerifiedFile(test, a.token, "PARTNER_EVIDENCE");
      const report = { lotId, kind: "DAMAGE", quantity: 2, description: "Two wigs arrived at the buyer crushed in their boxes." };
      await post(owner, "/v1/vendor/claims", { ...report, fileIds: [foreign] }).expect(400);
      const photo = await uploadVerifiedFile(test, owner, "GENERAL_ATTACHMENT");
      await post(owner, "/v1/vendor/claims", { ...report, quantity: 9, fileIds: [photo] }).expect(400);
      const created = (await post(owner, "/v1/vendor/claims", { ...report, fileIds: [photo] }).expect(201)).body as ClaimView;
      expect(created).toMatchObject({ source: "VENDOR_REPORT", amountMinor: 9_000, status: "OPEN" });
      await post(owner, "/v1/vendor/claims", { ...report, fileIds: [photo] }).expect(409);
      await post(superAdmin, `/v1/admin/claims/${created.id}/assessment`, { liability: "PLATFORM", amountMinor: 9_000, writeOff: true, note: "Damaged in storage, write them off." }).expect(200);
      await post(superAdmin, `/v1/admin/claims/${created.id}/decision`, { approve: true, note: "Approve my own." }).expect(403);
      const settled = (await post(financeB, `/v1/admin/claims/${created.id}/decision`, { approve: true, note: "Approved." }).expect(200)).body as ClaimView;
      expect(settled).toMatchObject({ status: "SETTLED", platformCoverMinor: 9_000 });
      expect((await lot()).quantity_available).toBe(3);
      const writeOff = await query("SELECT 1 FROM inventory_movements WHERE lot_id = $1 AND type = 'WRITE_OFF' AND delta_available = -2", [lotId]);
      expect(writeOff).toHaveLength(1);
    });
  });

  describe("stock counts and alerts", () => {
    it("raises an alert when a count comes up short, and opens claims when it's resolved", async () => {
      await post(superAdmin, `/v1/admin/partners/${b.partnerId}/stock-counts`, { lines: 5, dueInHours: 24 }).expect(201);
      const [count] = await get<StockCountView[]>(b.token, "/v1/warehouse/stock-counts");
      const video = await uploadVerifiedFile(test, b.token, "STOCK_COUNT");
      const lines = count!.lines.map((line) => ({ lineId: line.id, countedQuantity: 1 }));
      const submitted = await post(b.token, `/v1/warehouse/stock-counts/${count!.id}/submit`, { videoFileId: video, lines }).expect(200);
      expect(submitted.body.status).toBe("FLAGGED");
      const alerts = await get<CustodyAlertView[]>(opsGB, "/v1/admin/custody-alerts");
      expect(alerts).toEqual([expect.objectContaining({ kind: "COUNT_SHORTFALL", partnerId: b.partnerId, subjectId: count!.id })]);
      expect(await get<CustodyAlertView[]>(opsUS, "/v1/admin/custody-alerts")).toEqual([]);
      const resolved = await post(superAdmin, `/v1/admin/stock-counts/${count!.id}/resolve`, { note: "Two missing on the video, opening a claim.", openClaims: true }).expect(200);
      expect(resolved.body.claimsOpened).toBe(1);
      const claim = await query<{ quantity: number; partner_id: string }>("SELECT quantity, partner_id FROM custody_claims WHERE stock_count_id = $1", [count!.id]);
      expect(claim).toEqual([{ quantity: 2, partner_id: b.partnerId }]);
      expect(await get<CustodyAlertView[]>(opsGB, "/v1/admin/custody-alerts")).toEqual([]);
    });
  });

  describe("trust", () => {
    it("scores each hub from its record and shows the partner why", async () => {
      const trust = await get<TrustView>(a.token, "/v1/partner/trust");
      expect(trust).toEqual({ score: 90, floor: 50, factors: [{ label: "Losses you were responsible for", points: -10 }] });
      expect(await get<TrustView>(opsGB, `/v1/admin/partners/${a.partnerId}/trust`)).toEqual(trust);
      await get(b.token, `/v1/admin/partners/${a.partnerId}/trust`, 404);
      await get(opsUS, `/v1/admin/partners/${a.partnerId}/trust`, 404);
    });

    it("pauses a hub that falls below the floor, asks for a full count and lets it still count", async () => {
      await setRule("trustFloor", 80);
      const summary = await test.app.get(CustodyUpkeepService).run();
      await setRule("trustFloor", 50);
      expect(summary.trustSuspensions).toBe(1);
      expect((await get<PartnerDetailView>(b.token, "/v1/partner")).status).toBe("SUSPENDED");
      expect((await get<PartnerDetailView>(a.token, "/v1/partner")).status).toBe("ACTIVE");
      const alerts = await get<CustodyAlertView[]>(opsGB, "/v1/admin/custody-alerts");
      expect(alerts.map((alert) => alert.kind)).toEqual(["TRUST_LOW"]);
      const counts = await get<StockCountView[]>(b.token, "/v1/warehouse/stock-counts");
      expect(counts[0]).toMatchObject({ status: "REQUESTED" });
      await get(b.token, "/v1/warehouse/inbound", 403);
      expect(test.email.lastTo("lead-b@partner.test")!.subject).toBe("Your hub has been paused");
    });
  });

  describe("hub signals", () => {
    it("tells vendors who holds their stock and how well covered it is", async () => {
      const hubs = await get<HubSignalView[]>(owner, "/v1/vendor/hubs");
      const hubB = hubs.find((hub) => hub.warehouseId === b.hubId);
      expect(hubB).toMatchObject({ operator: "PARTNER", units: 3, currency: "GBP", lastCountedAt: null });
      expect(hubs.find((hub) => hub.warehouseId === a.hubId)).toMatchObject({ units: 0 });
      await get(a.token, "/v1/vendor/hubs", 404);
    });
  });

  describe("audit anchoring", () => {
    it("writes the latest audit hash outside the database once a day", async () => {
      const anchors = test.app.get(AuditAnchorService);
      const today = new Date("2026-10-25T23:50:00Z");
      const anchor = await anchors.anchor(today);
      const [latest] = await query<{ hash: string }>("SELECT hash FROM audit_log_entries ORDER BY sequence DESC LIMIT 1");
      expect(anchor).toMatchObject({ date: "2026-10-25", hash: latest!.hash });
      expect(test.storage.has(anchorKey("2026-10-25"))).toBe(true);
      expect(await anchors.anchor(today)).toBeNull();
    });
  });
});
