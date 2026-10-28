import type { HubView, PartnerDetailView, PartnerProgrammeView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp, testSignature } from "./harness";
import { application, as, inDays, PartnerFlow, query } from "./partner-helpers";

describe("partner applications and verification", () => {
  let test: TestApp;
  let flow: PartnerFlow;
  let superAdmin: string;
  let complianceA: string;
  let complianceB: string;
  let financeA: string;
  let financeB: string;
  let usOps: string;
  let leadA: string;
  let partnerA: string;
  let leadB: string;
  let partnerB: string;

  const decide = (token: string, partnerId: string, decision: string, reason = "Reviewed against the partner standard.") =>
    test.http().post(`/v1/admin/partners/${partnerId}/decisions/${decision}`).set(as(token)).send({ reason });
  const review = (token: string, partnerId: string, kind: string, body: object) => test.http().post(`/v1/admin/partners/${partnerId}/checks/${kind}/review`).set(as(token)).send(body);

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    await insertLegalDocument("US", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    flow = new PartnerFlow(test);
    const staffMember = async (email: string, role: string, countryCode: string | null = null) => {
      await flushRateLimits();
      return createStaff(test, email, role, countryCode);
    };
    superAdmin = await staffMember("super@gfn.test", "SUPER_ADMIN");
    complianceA = await staffMember("compliance-a@gfn.test", "COMPLIANCE");
    complianceB = await staffMember("compliance-b@gfn.test", "COMPLIANCE");
    financeA = await staffMember("finance-a@gfn.test", "FINANCE_ADMIN");
    financeB = await staffMember("finance-b@gfn.test", "FINANCE_ADMIN");
    usOps = await staffMember("ops-us@gfn.test", "COUNTRY_OPS", "US");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("the public partner page", () => {
    it("lists only countries with a live hub, and shows what partners earn", async () => {
      expect((await test.http().get("/v1/public/hubs").expect(200)).body).toEqual([]);
      const programmes = (await test.http().get("/v1/public/partner-programme").expect(200)).body as PartnerProgrammeView[];
      expect(programmes.map((programme) => programme.countryCode)).toEqual(["GB", "US"]);
      expect(programmes[0]).toMatchObject({
        currency: "GBP",
        receivingShareBps: 7000,
        storageShareBps: 7000,
        fulfilmentShareBps: 7000,
        foundingBonusBps: 500,
        foundingPlacesLeft: 5,
        holdbackBps: 2000,
        holdbackDays: 60,
      });
      expect(programmes[0]!.example).toEqual({ boxesReceived: 20, boxesStored: 30, ordersPacked: 100, monthlyMinor: 69_230 });
    });

    it("takes applications with a referee and answers the same whether or not the email is known", async () => {
      const invalid = await test
        .http()
        .post("/v1/public/partner-applications")
        .send({ ...application("nobody@partner.test", "No Referee"), referee: undefined })
        .expect(400);
      expect(Object.keys(invalid.body.fieldErrors)).toContain("referee");
      await test
        .http()
        .post("/v1/public/partner-applications")
        .send(application("closed@partner.test", "Elsewhere", "FR"))
        .expect(400);
      ({ token: leadA, partnerId: partnerA } = await flow.apply("lead-a@partner.test", "Ada Obi"));
      await test.http().post("/v1/public/partner-applications").send(application("lead-a@partner.test", "Ada Obi")).expect(202);
      await test.http().post("/v1/public/partner-applications").send(application("compliance-a@gfn.test", "Someone Else")).expect(202);
      const partners = await query<{ status: string; contact_email: string }>("SELECT status, contact_email FROM fulfilment_partners ORDER BY created_at");
      expect(partners).toEqual([{ status: "VERIFYING", contact_email: "lead-a@partner.test" }]);
      const me = await test.http().get("/v1/auth/me").set(as(leadA)).expect(200);
      expect(me.body).toMatchObject({ role: "FULFILMENT_PARTNER", partnerId: partnerA, partnerStatus: "VERIFYING" });
      const overview = await flow.overview(leadA);
      expect(overview.checks.find((check) => check.kind === "REFERRAL")).toMatchObject({ status: "SUBMITTED", details: { name: "Pastor Bayo" } });
      ({ token: leadB, partnerId: partnerB } = await flow.apply("lead-b@partner.test", "Bisi Ade"));
    });

    it("keeps applicants out of hub work, vendor routes and administration", async () => {
      const blocked = await test.http().get("/v1/warehouse/warehouses").set(as(leadA)).expect(403);
      expect(blocked.body.message).toMatch(/once your partnership is active/);
      for (const path of ["/v1/vendor/orders", "/v1/admin/partners", "/v1/admin/staff", "/v1/admin/partner-payouts", "/v1/admin/stock-counts"]) {
        await test.http().get(path).set(as(leadA)).expect(404);
      }
      await test.http().get(`/v1/admin/partners/${partnerA}`).set(as(usOps)).expect(404);
    });
  });

  describe("verification steps", () => {
    it("lists what's missing before review", async () => {
      const early = await test.http().post("/v1/partner/submit").set(as(leadA)).expect(400);
      expect(Object.keys(early.body.fieldErrors).sort()).toEqual(["agreement", "checks", "payoutAccount"]);
    });

    it("verifies identity through the provider and keeps only the outcome", async () => {
      const started = await test.http().post("/v1/partner/identity/session").set(as(leadA)).expect(200);
      expect(started.body.url).toContain("/admin/partnership?identity=returned");
      const refreshed = await test.http().post("/v1/partner/identity/refresh").set(as(leadA)).expect(200);
      expect((refreshed.body as PartnerDetailView).checks.find((check) => check.kind === "IDENTITY")).toMatchObject({ status: "ACCEPTED", details: { provider: "PRACTICE" } });
      const [row] = await query<{ details: Record<string, unknown> }>("SELECT details FROM partner_checks WHERE partner_id = $1 AND kind = 'IDENTITY'", [partnerA]);
      expect(Object.keys(row!.details).sort()).toEqual(["provider", "sessionId", "verifiedAt"]);
    });

    it("needs a recent proof of address the partner uploaded", async () => {
      const [old] = await flow.files(leadA, 1, "PROOF_OF_ADDRESS");
      await test
        .http()
        .put("/v1/partner/verification/proof-of-address")
        .set(as(leadA))
        .send({ documentType: "UTILITY_BILL", issuedOn: inDays(-120), fileId: old })
        .expect(400);
      const [foreign] = await flow.files(leadB, 1, "PROOF_OF_ADDRESS");
      await test
        .http()
        .put("/v1/partner/verification/proof-of-address")
        .set(as(leadA))
        .send({ documentType: "UTILITY_BILL", issuedOn: inDays(-10), fileId: foreign })
        .expect(400);
      await test
        .http()
        .put("/v1/partner/verification/proof-of-address")
        .set(as(leadA))
        .send({ documentType: "BANK_STATEMENT", issuedOn: inDays(-10), fileId: old })
        .expect(200);
    });

    it("needs photos or video of the storage space", async () => {
      const photos = await flow.files(leadA, 2, "PARTNER_EVIDENCE");
      await test
        .http()
        .put("/v1/partner/verification/storage-space")
        .set(as(leadA))
        .send({ description: "Spare room with shelving.", fileIds: [photos[0]] })
        .expect(400);
      await test.http().put("/v1/partner/verification/storage-space").set(as(leadA)).send({ description: "Spare room with metal shelving and a lock.", fileIds: photos }).expect(200);
    });

    it("checks the tax reference against the country's format and stores it encrypted", async () => {
      await test.http().put("/v1/partner/verification/work-status").set(as(leadA)).send({ declaration: true, taxId: "12AB" }).expect(400);
      await test.http().put("/v1/partner/verification/work-status").set(as(leadA)).send({ taxId: "1234567890" }).expect(400);
      const declared = await test.http().put("/v1/partner/verification/work-status").set(as(leadA)).send({ declaration: true, taxId: "12345 67890" }).expect(200);
      expect((declared.body as PartnerDetailView).checks.find((check) => check.kind === "WORK_STATUS")).toMatchObject({ status: "ACCEPTED", details: { taxIdProvided: true } });
      const [row] = await query<{ details: string }>("SELECT details::text FROM partner_checks WHERE partner_id = $1 AND kind = 'WORK_STATUS'", [partnerA]);
      expect(row!.details).not.toContain("1234567890");
    });

    it("signs the agreement with the partner's typed name and keeps a fingerprint of what was signed", async () => {
      const { agreements } = await flow.overview(leadA);
      await test
        .http()
        .post("/v1/partner/agreement/sign")
        .set(as(leadA))
        .send({ documentId: agreements[0]!.documentId, signature: testSignature("Someone Else") })
        .expect(400);
      const signed = await test
        .http()
        .post("/v1/partner/agreement/sign")
        .set(as(leadA))
        .send({ documentId: agreements[0]!.documentId, signature: testSignature("  ada  OBI ") })
        .expect(200);
      expect((signed.body as PartnerDetailView).agreements[0]).toMatchObject({
        kind: "PARTNER_AGREEMENT",
        signatureName: "ada OBI",
        certificate: { reference: expect.stringMatching(/^PSG-[A-Z2-9]{10}$/), signerName: "ada OBI", method: "TYPED", documentSha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      });
      const [row] = await query<{ document_sha256: string; ip: string }>("SELECT document_sha256, ip FROM partner_agreement_acceptances WHERE partner_id = $1", [partnerA]);
      expect(row!.document_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("sets up payouts with the provider and never stores bank numbers", async () => {
      const setup = await test.http().post("/v1/partner/payouts/setup").set(as(leadA)).expect(200);
      expect(setup.body.url).toContain("payouts=returned");
      const refreshed = await test.http().post("/v1/partner/payouts/refresh").set(as(leadA)).expect(200);
      expect((refreshed.body as PartnerDetailView).payoutAccount).toMatchObject({ provider: "PRACTICE", status: "ACTIVE", bankSummary: "Practice Bank ••••4242" });
      const columns = await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'partner_payout_accounts'");
      expect(columns.map((column) => column.column_name)).not.toContain("details_encrypted");
    });

    it("sends the application for review and locks the details", async () => {
      const sent = await test.http().post("/v1/partner/submit").set(as(leadA)).expect(200);
      expect(sent.body.status).toBe("UNDER_REVIEW");
      await test.http().put("/v1/partner/referee").set(as(leadA)).send({ name: "Someone", contact: "someone@example.com", relationship: "Neighbour" }).expect(409);
    });
  });

  describe("review and approval", () => {
    it("returns the application when a document falls short", async () => {
      await review(complianceA, partnerA, "PROOF_OF_ADDRESS", { accept: true, note: "Looks fine to me." }).expect(400);
      await review(complianceA, partnerA, "PROOF_OF_ADDRESS", { accept: false, note: "The statement shows a different flat number." }).expect(201);
      await review(complianceA, partnerA, "IDENTITY", { accept: true, note: "Trying to override the provider." }).expect(404);
      await decide(complianceA, partnerA, "RETURN").expect(201);
      const returned = await flow.overview(leadA);
      expect(returned).toMatchObject({ status: "VERIFYING" });
      expect(returned.checks.find((check) => check.kind === "PROOF_OF_ADDRESS")).toMatchObject({ status: "REJECTED", reviewNote: "The statement shows a different flat number." });
      const [proof] = await flow.files(leadA, 1, "PROOF_OF_ADDRESS");
      await test
        .http()
        .put("/v1/partner/verification/proof-of-address")
        .set(as(leadA))
        .send({ documentType: "UTILITY_BILL", issuedOn: inDays(-5), fileId: proof })
        .expect(200);
      await test.http().post("/v1/partner/submit").set(as(leadA)).expect(200);
    });

    it("books a video call to see the storage space and records the outcome", async () => {
      await test.http().post(`/v1/admin/partners/${partnerA}/storage-call/outcome`).set(as(complianceA)).send({ outcome: "Saw the room, dry and lockable." }).expect(409);
      await test
        .http()
        .post(`/v1/admin/partners/${partnerA}/storage-call`)
        .set(as(complianceA))
        .send({ scheduledAt: new Date(Date.now() - 60_000).toISOString() })
        .expect(400);
      await test
        .http()
        .post(`/v1/admin/partners/${partnerA}/storage-call`)
        .set(as(complianceA))
        .send({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(201);
      expect(test.email.lastTo("lead-a@partner.test")!.subject).toContain("video call");
      const recorded = await test
        .http()
        .post(`/v1/admin/partners/${partnerA}/storage-call/outcome`)
        .set(as(complianceA))
        .send({ outcome: "Saw the room on video: dry, shelved and lockable." })
        .expect(201);
      expect((recorded.body as PartnerDetailView).checks.find((check) => check.kind === "STORAGE_SPACE")!.callOutcome).toContain("lockable");
    });

    it("shows reviewers only files linked to this partner", async () => {
      const detail = (await test.http().get(`/v1/admin/partners/${partnerA}`).set(as(complianceA)).expect(200)).body as PartnerDetailView;
      const proofFile = detail.checks.find((check) => check.kind === "PROOF_OF_ADDRESS")!.fileIds[0]!;
      await test.http().get(`/v1/admin/partners/${partnerA}/files/${proofFile}`).set(as(complianceA)).expect(200);
      await test.http().get(`/v1/admin/partners/${partnerB}/files/${proofFile}`).set(as(complianceA)).expect(404);
      const [audits] = await query<{ count: string }>("SELECT count(*) FROM audit_log_entries WHERE action = 'file.viewed' AND resource_id = $1", [proofFile]);
      expect(Number(audits!.count)).toBe(1);
    });

    it("approves once every step is accepted, creating the hub at the storage address", async () => {
      const early = await decide(complianceA, partnerA, "APPROVE").expect(409);
      expect(early.body.message).toBe("Still needed: every verification step accepted.");
      await flow.acceptReviewedSteps(complianceA, partnerA);
      const selfApproved = await decide(complianceA, partnerA, "APPROVE").expect(403);
      expect(selfApproved.body.message).toBe("Someone who didn't review the verification steps approves the partner.");
      const approved = (await decide(complianceB, partnerA, "APPROVE").expect(201)).body as PartnerDetailView;
      expect(approved).toMatchObject({ status: "ACTIVE", tierLevel: 1, founding: true, tier: { name: "Starter", maxStockValueMinor: 50_000 } });
      expect(approved.warehouses).toEqual([{ id: expect.any(String), code: expect.stringMatching(/^HUB-[A-Z2-9]{6}$/), name: "Manchester hub" }]);
      expect(test.email.lastTo("lead-a@partner.test")!.text).toContain("Your hub is live");
      const hubs = (await test.http().get("/v1/public/hubs").expect(200)).body as HubView[];
      expect(hubs).toEqual([{ countryCode: "GB", countryName: "United Kingdom", currency: "GBP", insuredCoverMinor: 1_000_000 }]);
      const warehouses = (await test.http().get("/v1/warehouse/warehouses").set(as(leadA)).expect(200)).body as Array<{ id: string }>;
      expect(warehouses.map((warehouse) => warehouse.id)).toEqual([approved.warehouses[0]!.id]);
    });
  });

  describe("changing details after checks", () => {
    it("asks for identity, address and signature again when the name or address changes", async () => {
      const { token } = await flow.apply("mover@partner.test", "Femi Cole");
      await test.http().post("/v1/partner/identity/session").set(as(token)).expect(200);
      await test.http().post("/v1/partner/identity/refresh").set(as(token)).expect(200);
      const [proof] = await flow.files(token, 1, "PROOF_OF_ADDRESS");
      await test
        .http()
        .put("/v1/partner/verification/proof-of-address")
        .set(as(token))
        .send({ documentType: "UTILITY_BILL", issuedOn: inDays(-10), fileId: proof })
        .expect(200);
      const { profile, agreements } = await flow.overview(token);
      await test
        .http()
        .post("/v1/partner/agreement/sign")
        .set(as(token))
        .send({ documentId: agreements[0]!.documentId, signature: testSignature("Femi Cole") })
        .expect(200);
      const moved = (
        await test
          .http()
          .put("/v1/partner/profile")
          .set(as(token))
          .send({ ...profile, addressLines: ["2 New Road"] })
          .expect(200)
      ).body as PartnerDetailView;
      const status = (view: PartnerDetailView, kind: string) => view.checks.find((check) => check.kind === kind)!.status;
      expect([status(moved, "IDENTITY"), status(moved, "PROOF_OF_ADDRESS"), status(moved, "STORAGE_SPACE")]).toEqual(["ACCEPTED", "NOT_STARTED", "NOT_STARTED"]);
      const [file] = await query<{ status: string }>("SELECT status FROM stored_files WHERE id = $1", [proof]);
      expect(file!.status).toBe("PURGED");
      const renamed = (
        await test
          .http()
          .put("/v1/partner/profile")
          .set(as(token))
          .send({ ...profile, addressLines: ["2 New Road"], fullName: "Femi Coker" })
          .expect(200)
      ).body as PartnerDetailView;
      expect(status(renamed, "IDENTITY")).toBe("NOT_STARTED");
      expect(renamed.readiness.agreement).toBe(false);
    });
  });

  describe("optional deposit and insurance", () => {
    it("asks for a deposit only when one is required, confirmed by a second person", async () => {
      await test.http().put(`/v1/admin/partners/${partnerB}/requirements`).set(as(superAdmin)).send({ requiredDepositMinor: 20_000, requiredInsuranceMinor: 0 }).expect(200);
      await flow.completeSteps(leadB, "Bisi Ade");
      await flow.acceptReviewedSteps(complianceA, partnerB);
      const refused = await decide(complianceA, partnerB, "APPROVE").expect(409);
      expect(refused.body.message).toBe("Still needed: the deposit held and confirmed.");
      const recorded = await test.http().post(`/v1/admin/partners/${partnerB}/securities`).set(as(financeA)).send({ kind: "DEPOSIT", amountMinor: 20_000, reference: "BACS 2026-11-01" }).expect(201);
      const securityId = (recorded.body as PartnerDetailView).securities[0]!.id;
      await test.http().post(`/v1/admin/partners/${partnerB}/securities/${securityId}/confirm`).set(as(financeA)).expect(403);
      await test.http().post(`/v1/admin/partners/${partnerB}/securities/${securityId}/confirm`).set(as(financeB)).expect(201);
      const approved = await decide(complianceB, partnerB, "APPROVE").expect(201);
      expect(approved.body).toMatchObject({ status: "ACTIVE", founding: true });
    });

    it("only lets partner managers reinstate, offboard or terminate", async () => {
      await decide(complianceA, partnerB, "SUSPEND", "Stock count discrepancy under investigation.").expect(201);
      await test.http().get("/v1/warehouse/inbound").set(as(leadB)).expect(403);
      await decide(complianceA, partnerB, "REINSTATE").expect(403);
      await decide(superAdmin, partnerB, "REINSTATE", "Count reconciled, resuming operations.").expect(201);
      await test.http().get("/v1/warehouse/inbound").set(as(leadB)).expect(200);
    });

    it("ends a partnership with an empty hub and closes every account", async () => {
      await decide(superAdmin, partnerB, "OFFBOARD", "Partner asked to end the arrangement.").expect(201);
      await decide(superAdmin, partnerB, "TERMINATE", "Ending the partnership now.").expect(201);
      await test.http().get("/v1/partner").set(as(leadB)).expect(401);
      await expect(query("UPDATE fulfilment_partners SET status = 'ACTIVE' WHERE id = $1", [partnerB])).rejects.toThrow(/cannot move/);
    });
  });

  describe("data retention", () => {
    it("deletes proof of address, and a closed partner's space photos, once the retention period passes, keeping the decisions", async () => {
      const { PartnerUpkeepService } = await import("../src/modules/partners/jobs/partner-upkeep.service");
      const upkeep = test.app.get(PartnerUpkeepService);
      expect(await upkeep.purgeProofs(new Date())).toBe(0);
      const later = new Date(Date.now() + 100 * 86_400_000);
      expect(await upkeep.purgeProofs(later)).toBe(3);
      const [closedSpace] = await query<{ purged: boolean }>("SELECT files_purged_at IS NOT NULL AS purged FROM partner_checks WHERE partner_id = $1 AND kind = 'STORAGE_SPACE'", [partnerB]);
      expect(closedSpace!.purged).toBe(true);
      const proof = (await flow.overview(leadA)).checks.find((check) => check.kind === "PROOF_OF_ADDRESS")!;
      expect(proof).toMatchObject({ status: "ACCEPTED", filesPurged: true, fileIds: [] });
      const files = await query<{ status: string }>("SELECT status FROM stored_files WHERE purpose = 'PROOF_OF_ADDRESS' AND status = 'PURGED'");
      expect(files).toHaveLength(4);
    });
  });
});
