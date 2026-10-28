import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { createStaff, flushRateLimits, insertLegalDocument, refreshCookie, resetDatabase, signUpAndVerify, startApp, type TestApp, testSignature, uploadVerifiedFile, WEB_ORIGIN } from "./harness";

const ANSWERS = {
  businessType: "LIMITED_COMPANY",
  legalBusinessName: "Adaeze Hair Co Ltd",
  registrationCountryCode: "GB",
  companyNumber: "12345678",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postalCode: "M1 1AA" },
  contactFullName: "Adaeze Okafor",
  contactRole: "Director",
  contactPhone: "+447700900123",
  productsDescription: "Human hair wigs and extensions",
  monthlyUnits: "UP_TO_1000",
  monthlyOrders: "UP_TO_500",
  hazards: ["NONE"],
};

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

describe("vendor onboarding", () => {
  let test: TestApp;
  let vendor: { accessToken: string; vendorId: string };
  let compliance: string;
  let ukOps: string;
  let usOps: string;
  let generalAdmin: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    const signed = await signUpAndVerify(test, "owner@adaeze.example");
    const me = await test.http().get("/v1/auth/me").set(as(signed.accessToken)).expect(200);
    vendor = { accessToken: signed.accessToken, vendorId: me.body.vendorId };
    compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    ukOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
    usOps = await createStaff(test, "ops-us@gfn.test", "COUNTRY_OPS", "US");
    generalAdmin = await createStaff(test, "admin@gfn.test", "ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("serves the market's own rules and rejects answers outside them", async () => {
    const view = await test.http().get("/v1/vendor/verification").set(as(vendor.accessToken)).expect(200);
    expect(view.body.status).toBe("NOT_STARTED");
    expect(view.body.market.kyc.companyNumber.label).toBe("Companies House number");
    const bad = await test.http().put("/v1/vendor/verification").set(as(vendor.accessToken)).send({ businessType: "LLC" }).expect(400);
    expect(bad.body.fieldErrors.businessType).toBeDefined();
  });

  it("encrypts answers at rest and no longer takes a typed ID number", async () => {
    const saved = await test
      .http()
      .put("/v1/vendor/verification")
      .set(as(vendor.accessToken))
      .send({ ...ANSWERS, idNumber: "533401872" })
      .expect(200);
    expect(saved.body.status).toBe("IN_PROGRESS");
    expect(saved.body.idNumberLast4).toBeNull();
    expect(saved.body.identityCheck).toBeNull();
    const [row] = await query<{ answers_encrypted: string; id_number_encrypted: string | null }>("SELECT answers_encrypted, id_number_encrypted FROM vendor_verifications WHERE vendor_id = $1", [
      vendor.vendorId,
    ]);
    expect(row!.answers_encrypted).not.toContain("Adaeze");
    expect(row!.answers_encrypted).not.toContain("+4477");
    expect(row!.id_number_encrypted).toBeNull();
  });

  it("keeps a draft away from staff until the vendor submits it", async () => {
    await test.http().get(`/v1/admin/verifications/${vendor.vendorId}`).set(as(compliance)).expect(404);
    await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/id-number`).set(as(compliance)).expect(404);
    const queue = await test.http().get("/v1/admin/verifications").set(as(compliance)).expect(200);
    expect(queue.body).toEqual([]);
    const inProgress = await test.http().get("/v1/admin/verifications?status=IN_PROGRESS").set(as(compliance)).expect(200);
    expect(inProgress.body).toEqual([]);
  });

  it("refuses to submit until the business document is uploaded and identity is checked", async () => {
    const missing = await test.http().post("/v1/vendor/verification/submit").set(as(vendor.accessToken)).expect(400);
    expect(missing.body.fieldErrors["documents.businessDocument"]).toBeDefined();
    expect(missing.body.fieldErrors.identity).toEqual(["Verify your identity first"]);
  });

  it("will not reference another vendor's files", async () => {
    const other = await signUpAndVerify(test, "other@vendor.example");
    const foreignFile = await uploadVerifiedFile(test, other.accessToken);
    await test
      .http()
      .put("/v1/vendor/verification")
      .set(as(vendor.accessToken))
      .send({ documents: { businessDocument: foreignFile } })
      .expect(400);
  });

  it("submits, then locks the answers while under review", async () => {
    const documents = { businessDocument: await uploadVerifiedFile(test, vendor.accessToken) };
    await test.http().put("/v1/vendor/verification").set(as(vendor.accessToken)).send({ documents }).expect(200);
    await test.http().post("/v1/vendor/verification/identity/session").set(as(vendor.accessToken)).expect(200);
    const checked = await test.http().post("/v1/vendor/verification/identity/refresh").set(as(vendor.accessToken)).expect(200);
    expect(checked.body.identityCheck).toMatchObject({ status: "APPROVED", provider: "PRACTICE" });
    const submitted = await test.http().post("/v1/vendor/verification/submit").set(as(vendor.accessToken)).expect(200);
    expect(submitted.body.status).toBe("SUBMITTED");
    await test.http().put("/v1/vendor/verification").set(as(vendor.accessToken)).send({ contactRole: "CEO" }).expect(409);
  });

  it("scopes country operations staff to their own country", async () => {
    const ukQueue = await test.http().get("/v1/admin/verifications?status=SUBMITTED").set(as(ukOps)).expect(200);
    expect((ukQueue.body as Array<{ vendorId: string }>).map((entry) => entry.vendorId)).toContain(vendor.vendorId);
    const usQueue = await test.http().get("/v1/admin/verifications").set(as(usOps)).expect(200);
    expect(usQueue.body).toEqual([]);
    await test.http().get(`/v1/admin/verifications/${vendor.vendorId}`).set(as(usOps)).expect(404);
  });

  it("lets readers see the case but only reviewers open documents or the ID number", async () => {
    const detail = await test.http().get(`/v1/admin/verifications/${vendor.vendorId}`).set(as(generalAdmin)).expect(200);
    expect(detail.body.identityCheck).toMatchObject({ status: "APPROVED", provider: "PRACTICE" });
    await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/documents/businessDocument/url`).set(as(generalAdmin)).expect(404);
    await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/id-number`).set(as(ukOps)).expect(404);
    await test.http().get("/v1/admin/verifications").set(as(vendor.accessToken)).expect(404);

    const url = await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/documents/businessDocument/url`).set(as(compliance)).expect(200);
    expect(url.body.url).toMatch(/^memory:\/\/verified\//);
    const revealed = await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/id-number`).set(as(compliance)).expect(200);
    expect(revealed.body.idNumber).toBeNull();

    const audit = await query<{ action: string }>("SELECT action FROM audit_log_entries WHERE vendor_id = $1 AND action IN ('file.viewed_by_reviewer', 'verification.id_number_revealed')", [
      vendor.vendorId,
    ]);
    expect(audit.map((entry) => entry.action).sort()).toEqual(["file.viewed_by_reviewer", "verification.id_number_revealed"]);
  });

  it("needs a reason to send a case back, and reopens it for the vendor", async () => {
    await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/decision`).set(as(compliance)).send({ decision: "REQUEST_RESUBMISSION" }).expect(400);
    await test
      .http()
      .post(`/v1/admin/verifications/${vendor.vendorId}/decision`)
      .set(as(compliance))
      .send({ decision: "REQUEST_RESUBMISSION", reason: "The business document is blurry, please scan it again." })
      .expect(200);
    expect(test.email.lastTo("owner@adaeze.example")!.text).toContain("business document is blurry");
    const businessDocument = await uploadVerifiedFile(test, vendor.accessToken);
    await test.http().put("/v1/vendor/verification").set(as(vendor.accessToken)).send({ documents: { businessDocument } }).expect(200);
    await test.http().post("/v1/vendor/verification/submit").set(as(vendor.accessToken)).expect(200);
  });

  it("activates the vendor only once approved and the current agreement is accepted", async () => {
    const approved = await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/decision`).set(as(compliance)).send({ decision: "APPROVE" }).expect(200);
    expect(approved.body).toEqual({ status: "APPROVED", vendorActive: false });
    await test.http().post(`/v1/admin/verifications/${vendor.vendorId}/decision`).set(as(compliance)).send({ decision: "APPROVE" }).expect(409);

    const [oldAgreement] = (await test.http().get("/v1/vendor/agreements").set(as(vendor.accessToken)).expect(200)).body as Array<{ document: { id: string } }>;
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.1");
    await test.http().post(`/v1/vendor/agreements/${oldAgreement!.document.id}/accept`).set(as(vendor.accessToken)).expect(409);

    const [current] = (await test.http().get("/v1/vendor/agreements").set(as(vendor.accessToken)).expect(200)).body as Array<{ document: { id: string; version: string } }>;
    expect(current!.document.version).toBe("1.1");
    const unsigned = await test.http().post(`/v1/vendor/agreements/${current!.document.id}/accept`).set(as(vendor.accessToken)).send({}).expect(400);
    expect(unsigned.body.fieldErrors).toEqual({ signature: ["Sign the agreement to accept it."] });
    await test
      .http()
      .post(`/v1/vendor/agreements/${current!.document.id}/accept`)
      .set(as(vendor.accessToken))
      .send({ signature: { ...testSignature("Amara Obi", "DRAWN"), image: "data:text/html;base64,PHNjcmlwdD4=" } })
      .expect(400);
    const accepted = await test
      .http()
      .post(`/v1/vendor/agreements/${current!.document.id}/accept`)
      .set(as(vendor.accessToken))
      .send({ signature: testSignature("Amara Obi", "DRAWN") })
      .expect(200);
    expect(accepted.body).toEqual({ vendorActive: true });
    const [signedAgreement] = (await test.http().get("/v1/vendor/agreements").set(as(vendor.accessToken)).expect(200)).body as Array<{ certificate: Record<string, unknown> | null }>;
    expect(signedAgreement!.certificate).toEqual({
      reference: expect.stringMatching(/^PSG-[A-Z2-9]{10}$/),
      documentTitle: expect.any(String),
      documentVersion: "1.1",
      documentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      signerName: "Amara Obi",
      signerEmail: expect.any(String),
      method: "DRAWN",
      image: expect.stringMatching(/^data:image\/png;base64,/),
      signedAt: expect.any(String),
      ip: expect.any(String),
    });
    const [row] = await query<{ status: string }>("SELECT status FROM vendors WHERE id = $1", [vendor.vendorId]);
    expect(row!.status).toBe("ACTIVE");
    await expect(query("UPDATE legal_documents SET body = 'changed'")).rejects.toThrow(/append-only/);
  });

  it("invites a team member who can read but not manage, and removal ends their session", async () => {
    await test.http().post("/v1/vendor/team/invitations").set(as(vendor.accessToken)).send({ email: "staff@adaeze.example" }).expect(202);
    const link = test.email.lastTo("staff@adaeze.example")!.text;
    const token = decodeURIComponent(/#token=([^\s]+)/.exec(link)![1]!);
    const preview = await test.http().post("/v1/invitations/preview").send({ token }).expect(200);
    expect(preview.body).toEqual({ businessName: "Acme Goods", email: "staff@adaeze.example" });

    const accepted = await test.http().post("/v1/invitations/accept").send({ token, password: "a member's own password" }).expect(200);
    expect(accepted.body.user.role).toBe("VENDOR_MEMBER");
    expect(refreshCookie(accepted.headers["set-cookie"])).toMatch(/^gfn_rt=/);
    await test.http().post("/v1/invitations/accept").send({ token, password: "replaying the invite" }).expect(400);

    const member = as(accepted.body.accessToken);
    await test.http().get("/v1/vendor/team").set(member).expect(200);

    const memberView = await test.http().get("/v1/vendor/verification").set(member).expect(200);
    expect(memberView.body).toMatchObject({ status: "APPROVED", draft: {}, idNumberLast4: null, identityCheck: null, documents: [] });
    const ownerView = await test.http().get("/v1/vendor/verification").set(as(vendor.accessToken)).expect(200);
    const businessDocument = (ownerView.body.documents as Array<{ slot: string; fileId: string }>).find((document) => document.slot === "businessDocument")!.fileId;
    await test.http().get(`/v1/files/${businessDocument}/download-url`).set(member).expect(404);
    await test.http().get(`/v1/files/${businessDocument}/download-url`).set(as(vendor.accessToken)).expect(200);
    await test.http().post("/v1/files/uploads").set(member).send({ purpose: "KYC_DOCUMENT", contentType: "image/png", sizeBytes: 100 }).expect(404);

    await test.http().post("/v1/vendor/team/invitations").set(member).send({ email: "x@y.example" }).expect(404);
    await test.http().put("/v1/vendor/verification").set(member).send({ contactRole: "CEO" }).expect(404);

    await test.http().delete(`/v1/vendor/team/members/${accepted.body.user.id}`).set(as(vendor.accessToken)).expect(204);
    await test.http().get("/v1/vendor/team").set(member).expect(401);
    await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", refreshCookie(accepted.headers["set-cookie"])).expect(401);
  });

  it("re-checks the team size when an invitation is accepted", async () => {
    await test.http().post("/v1/vendor/team/invitations").set(as(vendor.accessToken)).send({ email: "late@adaeze.example" }).expect(202);
    const token = decodeURIComponent(/#token=([^\s]+)/.exec(test.email.lastTo("late@adaeze.example")!.text)![1]!);
    await query(
      `INSERT INTO users (email, password_hash, role, vendor_id, country_code, status, email_verified_at)
       SELECT 'filler' || n || '@adaeze.example', 'unused', 'VENDOR_MEMBER', $1, 'GB', 'ACTIVE', now()
       FROM generate_series(1, 60) AS n`,
      [vendor.vendorId],
    );
    await test.http().post("/v1/invitations/accept").send({ token, password: "a member's own password" }).expect(409);
    await query("DELETE FROM users WHERE email LIKE 'filler%@adaeze.example'");
  });

  it("agrees on one latest version when two are published at the same instant", async () => {
    await query(
      `INSERT INTO legal_documents (country_code, kind, version, title, body, published_at)
       SELECT 'GB', 'PRIVACY', v, 'Privacy ' || v, 'Privacy notice body that is long enough for validation.', '2030-01-01T00:00:00Z'
       FROM unnest(ARRAY['a', 'b']) AS v`,
    );
    const listed = (await test.http().get("/v1/vendor/agreements").set(as(vendor.accessToken)).expect(200)).body as Array<{ document: { id: string; kind: string } }>;
    const privacy = listed.find((entry) => entry.document.kind === "PRIVACY")!;
    await test.http().post(`/v1/vendor/agreements/${privacy.document.id}/accept`).set(as(vendor.accessToken)).expect(200);
  });
});
