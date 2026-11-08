import type { PartnerDetailView, VendorDetailView } from "../src/shared";
import { codeFrom, createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, startApp, type TestApp, uploadVerifiedFile } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";

const PASSWORD = "a long enough password";
const REASON = { reason: "Closing this account on the owner's request." };

describe("deactivating and deleting accounts", () => {
  let test: TestApp;
  let flow: PartnerFlow;
  let superAdmin: string;
  let compliance: string;
  let countryOps: string;

  async function signUp(email: string, businessName: string): Promise<{ vendorId: string; token: string }> {
    await flushRateLimits();
    await test
      .http()
      .post("/v1/auth/signup")
      .send({ email, password: PASSWORD, businessName, countryCodes: ["GB"], acceptTerms: true })
      .expect(202);
    const code = codeFrom(test.email.lastTo(email)!.text);
    const verified = await test.http().post("/v1/auth/verify-email").send({ email, code, password: PASSWORD }).expect(200);
    const [user] = await query<{ vendor_id: string }>("SELECT vendor_id FROM users WHERE email = $1", [email]);
    return { vendorId: user!.vendor_id, token: verified.body.accessToken as string };
  }

  const vendorDetail = async (vendorId: string) => (await test.http().get(`/v1/admin/vendors/${vendorId}`).set(as(superAdmin)).expect(200)).body as VendorDetailView;
  const partnerDetail = async (partnerId: string) => (await test.http().get(`/v1/admin/partners/${partnerId}`).set(as(superAdmin)).expect(200)).body as PartnerDetailView;
  const login = (email: string) => test.http().post("/v1/auth/login").send({ email, password: PASSWORD });

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    flow = new PartnerFlow(test);
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    await flushRateLimits();
    compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    await flushRateLimits();
    countryOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("lets only a super admin close accounts", async () => {
    const { vendorId } = await signUp("guarded@vendors.example", "Guarded Goods");
    await test.http().post(`/v1/admin/vendors/${vendorId}/deactivate`).set(as(countryOps)).send(REASON).expect(404);
    await test.http().post(`/v1/admin/vendors/${vendorId}/delete`).set(as(compliance)).send(REASON).expect(404);
    await test.http().post(`/v1/admin/vendors/${vendorId}/delete`).set(as(superAdmin)).send({ reason: "short" }).expect(400);
    expect((await vendorDetail(vendorId)).control).toEqual({ deactivatedAt: null, deletable: true });
  });

  it("deactivates a live vendor, signs the team out, and brings it back as it was", async () => {
    const { vendorId, token } = await signUp("live@vendors.example", "Live Lace");
    await makeVendorTrade(vendorId);

    await test.http().post(`/v1/admin/vendors/${vendorId}/deactivate`).set(as(superAdmin)).send(REASON).expect(204);
    const paused = await vendorDetail(vendorId);
    expect(paused.stage).toBe("SUSPENDED");
    expect(paused.control.deactivatedAt).not.toBeNull();
    await test.http().get("/v1/auth/me").set(as(token)).expect(401);
    expect((await login("live@vendors.example").expect(403)).body.code).toBe("account_inactive");
    expect(test.email.lastTo("live@vendors.example")!.subject).toContain("deactivated");
    await test.http().post(`/v1/admin/vendors/${vendorId}/deactivate`).set(as(superAdmin)).send(REASON).expect(409);

    await test.http().post(`/v1/admin/vendors/${vendorId}/reactivate`).set(as(superAdmin)).send(REASON).expect(204);
    const back = await vendorDetail(vendorId);
    expect(back.stage).toBe("LIVE");
    expect(back.control.deactivatedAt).toBeNull();
    await login("live@vendors.example").expect(200);
    const audit = await query<{ action: string }>("SELECT action FROM audit_log_entries WHERE resource_id = $1 AND action LIKE 'vendor.%activated' ORDER BY sequence", [vendorId]);
    expect(audit.map((row) => row.action)).toEqual(["vendor.deactivated", "vendor.reactivated"]);
  });

  it("deletes a vendor with no trading history, with its team and files", async () => {
    const { vendorId, token } = await signUp("gone@vendors.example", "Gone Soon");
    await makeVendorTrade(vendorId);
    await expect(query("DELETE FROM agreement_acceptances WHERE vendor_id = $1", [vendorId])).rejects.toThrow("append-only");
    const fileId = await uploadVerifiedFile(test, token);
    const [file] = await query<{ object_key: string }>("SELECT object_key FROM stored_files WHERE id = $1", [fileId]);
    expect(test.storage.has(file!.object_key)).toBe(true);

    await test.http().post(`/v1/admin/vendors/${vendorId}/delete`).set(as(superAdmin)).send(REASON).expect(204);
    await test.http().get(`/v1/admin/vendors/${vendorId}`).set(as(superAdmin)).expect(404);
    expect(await query("SELECT 1 FROM users WHERE email = 'gone@vendors.example'")).toHaveLength(0);
    expect(await query("SELECT 1 FROM stored_files WHERE id = $1", [fileId])).toHaveLength(0);
    expect(test.storage.has(file!.object_key)).toBe(false);
    const [audit] = await query<{ before: { businessName: string } }>("SELECT before_state AS before FROM audit_log_entries WHERE resource_id = $1 AND action = 'vendor.deleted'", [vendorId]);
    expect(audit!.before.businessName).toBe("Gone Soon");

    await signUp("gone@vendors.example", "Back Again");
  });

  it("keeps a vendor with money on record and points to deactivating instead", async () => {
    const { vendorId } = await signUp("trading@vendors.example", "Trading Wigs");
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 5_000);
    expect((await vendorDetail(vendorId)).control.deletable).toBe(false);
    const refused = await test.http().post(`/v1/admin/vendors/${vendorId}/delete`).set(as(superAdmin)).send(REASON).expect(409);
    expect(refused.body.message).toContain("Deactivate it instead");
    await vendorDetail(vendorId);
  });

  it("deletes a partner application that never ran a hub", async () => {
    const { partnerId } = await flow.apply("applicant@partner.test", "Ada Obi");
    expect((await partnerDetail(partnerId)).control.deletable).toBe(true);
    await test.http().post(`/v1/admin/partners/${partnerId}/delete`).set(as(superAdmin)).send(REASON).expect(204);
    await test.http().get(`/v1/admin/partners/${partnerId}`).set(as(superAdmin)).expect(404);
    expect(await query("SELECT 1 FROM users WHERE email = 'applicant@partner.test'")).toHaveLength(0);
    expect(await query("SELECT 1 FROM audit_log_entries WHERE resource_id = $1 AND action = 'partner.deleted'", [partnerId])).toHaveLength(1);
  });

  it("pauses a live partner's hub and sign-in together, then resumes both", async () => {
    const { token, partnerId } = await flow.onboard("lead@partner.test", "Bisi Ade", compliance, superAdmin);
    expect((await partnerDetail(partnerId)).control.deletable).toBe(false);
    await test.http().post(`/v1/admin/partners/${partnerId}/delete`).set(as(superAdmin)).send(REASON).expect(409);

    await test.http().post(`/v1/admin/partners/${partnerId}/deactivate`).set(as(superAdmin)).send(REASON).expect(204);
    const paused = await partnerDetail(partnerId);
    expect(paused.status).toBe("SUSPENDED");
    expect(paused.decisions).toEqual(["OFFBOARD"]);
    expect(paused.control.deactivatedAt).not.toBeNull();
    await test.http().get("/v1/auth/me").set(as(token)).expect(401);
    await test.http().post(`/v1/admin/partners/${partnerId}/decisions/REINSTATE`).set(as(superAdmin)).send({ reason: "Trying to resume the hub early." }).expect(409);

    await test.http().post(`/v1/admin/partners/${partnerId}/reactivate`).set(as(superAdmin)).send(REASON).expect(204);
    const back = await partnerDetail(partnerId);
    expect(back.status).toBe("ACTIVE");
    expect(back.control.deactivatedAt).toBeNull();
  });

  it("lets a deactivated partner be closed for good", async () => {
    const { partnerId } = await flow.onboard("closing@partner.test", "Chris Lee", compliance, superAdmin);
    await test.http().post(`/v1/admin/partners/${partnerId}/deactivate`).set(as(superAdmin)).send(REASON).expect(204);
    const closing = { reason: "The partner asked to close their account." };
    await test.http().post(`/v1/admin/partners/${partnerId}/decisions/OFFBOARD`).set(as(superAdmin)).send(closing).expect(201);
    expect((await partnerDetail(partnerId)).decisions).toEqual(["TERMINATE"]);
    await test.http().post(`/v1/admin/partners/${partnerId}/decisions/TERMINATE`).set(as(superAdmin)).send(closing).expect(201);
    const ended = await partnerDetail(partnerId);
    expect(ended.status).toBe("TERMINATED");
    expect(ended.control.deactivatedAt).not.toBeNull();
  });
});
