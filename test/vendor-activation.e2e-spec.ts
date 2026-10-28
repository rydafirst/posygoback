import type { VendorActivationView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile } from "./harness";
import { as, query } from "./partner-helpers";

const ANSWERS = {
  businessType: "LIMITED_COMPANY",
  legalBusinessName: "Activation Hair Co Ltd",
  registrationCountryCode: "GB",
  companyNumber: "12345678",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postalCode: "M1 1AA" },
  contactFullName: "Ada Activation",
  contactRole: "Director",
  contactPhone: "+447700900123",
  idType: "PASSPORT",
  idNumber: "533401872",
  idExpiry: "2031-06-30",
  productsDescription: "Human hair wigs and extensions",
  monthlyUnits: "UP_TO_1000",
  monthlyOrders: "UP_TO_500",
  hazards: ["NONE"],
};

const PRODUCT = {
  code: "wig-bw-16",
  name: "Body wave wig 16 inch",
  countryOfOrigin: "CN",
  declaredValueMinor: 4500,
  weightGrams: 350,
  storageTier: "SMALL",
  barcodes: [{ value: "4006381333931", symbology: "EAN13" }],
};

interface Vendor {
  email: string;
  token: string;
  vendorId: string;
}

describe("vendor activation fee", () => {
  let test: TestApp;
  let superAdmin: string;
  let compliance: string;
  let generalAdmin: string;
  let liveBeforeFee: Vendor;

  const http = () => test.http();
  const kinds = (email: string) => test.email.sent.filter((message) => message.to === email).map((message) => message.kind);
  const vendorStatus = async (vendorId: string) => (await query<{ status: string }>("SELECT status FROM vendors WHERE id = $1", [vendorId]))[0]!.status;
  const activation = async (vendor: Vendor) => (await http().get("/v1/vendor/activation").set(as(vendor.token)).expect(200)).body as VendorActivationView;
  const setFee = (token: string, countryCode: string, activationFeeMinor: number) => http().put(`/v1/admin/countries/${countryCode}/activation-fee`).set(as(token)).send({ activationFeeMinor });

  async function signUp(email: string): Promise<Vendor> {
    const token = (await signUpAndVerify(test, email)).accessToken;
    const me = await http().get("/v1/auth/me").set(as(token)).expect(200);
    return { email, token, vendorId: me.body.vendorId as string };
  }

  async function verify(vendor: Vendor): Promise<void> {
    const documents = { idFront: await uploadVerifiedFile(test, vendor.token), selfie: await uploadVerifiedFile(test, vendor.token), businessDocument: await uploadVerifiedFile(test, vendor.token) };
    await http()
      .put("/v1/vendor/verification")
      .set(as(vendor.token))
      .send({ ...ANSWERS, documents })
      .expect(200);
    await http().post("/v1/vendor/verification/submit").set(as(vendor.token)).expect(200);
    await http().post(`/v1/admin/verifications/${vendor.vendorId}/decision`).set(as(compliance)).send({ decision: "APPROVE" }).expect(200);
  }

  async function acceptAgreement(vendor: Vendor): Promise<{ vendorActive: boolean }> {
    const [current] = (await http().get("/v1/vendor/agreements").set(as(vendor.token)).expect(200)).body as Array<{ document: { id: string } }>;
    return (await http().post(`/v1/vendor/agreements/${current!.document.id}/accept`).set(as(vendor.token)).expect(200)).body as { vendorActive: boolean };
  }

  async function awaitingActivation(email: string): Promise<Vendor> {
    const vendor = await signUp(email);
    await verify(vendor);
    expect(await acceptAgreement(vendor)).toEqual({ vendorActive: false });
    return vendor;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    generalAdmin = await createStaff(test, "admin@gfn.test", "ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("makes the vendor live straight after the agreement when the fee is zero", async () => {
    liveBeforeFee = await signUp("owner@free.example");
    await verify(liveBeforeFee);
    expect(await acceptAgreement(liveBeforeFee)).toEqual({ vendorActive: true });
    expect(await vendorStatus(liveBeforeFee.vendorId)).toBe("ACTIVE");
    expect(await activation(liveBeforeFee)).toEqual({ state: "LIVE", feeMinor: null, currency: "GBP", payment: null });
    expect(kinds(liveBeforeFee.email)).not.toContain("onboarding.activation_due");
  });

  it("lets only a super admin set the fee, and audits each change", async () => {
    await setFee(compliance, "GB", 800).expect(403);
    await setFee(generalAdmin, "GB", 800).expect(403);
    await setFee(liveBeforeFee.token, "GB", 800).expect(404);

    const changed = await setFee(superAdmin, "GB", 800).expect(200);
    expect(changed.body.config.activationFeeMinor).toBe(800);
    await setFee(superAdmin, "US", 1000).expect(200);
    await setFee(superAdmin, "US", 500).expect(200);
    await setFee(superAdmin, "GB", -1).expect(400);

    const audit = await query<{ country_code: string; before_state: { activationFeeMinor: number }; after_state: { activationFeeMinor: number; currency: string } }>(
      "SELECT country_code, before_state, after_state FROM audit_log_entries WHERE action = 'country.activation_fee_changed' ORDER BY sequence",
    );
    expect(audit.map((row) => [row.country_code, row.before_state.activationFeeMinor, row.after_state.activationFeeMinor, row.after_state.currency])).toEqual([
      ["GB", 0, 800, "GBP"],
      ["US", 0, 1000, "USD"],
      ["US", 1000, 500, "USD"],
    ]);

    const country = (await http().get("/v1/admin/countries/GB").set(as(superAdmin)).expect(200)).body;
    await http()
      .patch("/v1/admin/countries/GB")
      .set(as(superAdmin))
      .send({ config: { ...country.config, activationFeeMinor: 0 } })
      .expect(200);
    expect((await http().get("/v1/admin/countries/GB").set(as(superAdmin)).expect(200)).body.config.activationFeeMinor).toBe(800);
  });

  it("leaves a vendor who was already live untouched", async () => {
    expect(await vendorStatus(liveBeforeFee.vendorId)).toBe("ACTIVE");
    expect((await activation(liveBeforeFee)).state).toBe("LIVE");
    await http().post("/v1/vendor/products").set(as(liveBeforeFee.token)).send(PRODUCT).expect(201);
    await http().post("/v1/vendor/activation/checkout").set(as(liveBeforeFee.token)).expect(409);
  });

  it("holds a verified vendor until the fee is paid, then makes them live with a receipt", async () => {
    const vendor = await signUp("owner@paying.example");
    await verify(vendor);
    expect(test.email.lastTo(vendor.email)!.kind).toBe("onboarding.verification_approved");
    expect(test.email.lastTo(vendor.email)!.text).not.toMatch(/activation/i);
    expect((await activation(vendor)).state).toBe("NOT_READY");
    expect((await activation(vendor)).feeMinor).toBeNull();

    expect(await acceptAgreement(vendor)).toEqual({ vendorActive: false });
    const due = test.email.lastTo(vendor.email)!;
    expect(due.kind).toBe("onboarding.activation_due");
    expect(due.subject).toBe("You're verified: activate your account");
    expect(due.text).toContain("£8.00");
    expect(await vendorStatus(vendor.vendorId)).toBe("PENDING_VERIFICATION");
    expect(await activation(vendor)).toEqual({ state: "DUE", feeMinor: 800, currency: "GBP", payment: null });

    const blocked = await http().post("/v1/vendor/products").set(as(vendor.token)).send(PRODUCT).expect(403);
    expect(blocked.body.code).toBe("activation_required");

    const started = await http().post("/v1/vendor/activation/checkout").set(as(vendor.token)).expect(201);
    expect(started.body.live).toBe(false);
    expect(started.body.redirectUrl).toBe(`http://localhost:3000/verification/sandbox-checkout?payment=${started.body.paymentId}`);
    expect((await activation(vendor)).payment).toMatchObject({ id: started.body.paymentId, status: "PENDING", feeMinor: 800, currency: "GBP", paidAt: null });

    const paid = await http().post(`/v1/vendor/activation/payments/${started.body.paymentId}/sandbox-pay`).set(as(vendor.token)).expect(200);
    expect(paid.body.state).toBe("LIVE");
    expect(paid.body.payment).toMatchObject({ id: started.body.paymentId, status: "PAID" });
    expect(await vendorStatus(vendor.vendorId)).toBe("ACTIVE");

    const [row] = await query<{ status: string; fee_minor: string; paid_minor: string; currency: string; provider_reference: string; provider_payment_id: string; paid_at: Date | null }>(
      "SELECT * FROM vendor_activation_payments WHERE id = $1",
      [started.body.paymentId],
    );
    expect(row).toMatchObject({ status: "PAID", fee_minor: "800", paid_minor: "800", currency: "GBP", provider_reference: `sandbox_${started.body.paymentId}` });
    expect(row!.provider_payment_id).toBe(`sandbox_payment_${started.body.paymentId}`);
    expect(row!.paid_at).not.toBeNull();

    const receipt = test.email.lastTo(vendor.email)!;
    expect(receipt.kind).toBe("onboarding.account_live");
    expect(receipt.subject).toBe("Your account is live");
    expect(receipt.text).toContain("£8.00");

    const [complianceUser] = await query<{ id: string }>("SELECT id FROM users WHERE email = 'compliance@gfn.test'");
    const alerts = await query<{ title: string; body: string; href: string }>("SELECT title, body, href FROM notifications WHERE user_id = $1 AND title LIKE '%is live'", [complianceUser!.id]);
    expect(alerts).toEqual([{ title: "Acme Goods is live", body: "They paid the £8.00 activation fee.", href: "/admin/verifications" }]);

    await http().post(`/v1/vendor/activation/payments/${started.body.paymentId}/sandbox-pay`).set(as(vendor.token)).expect(200);
    expect(kinds(vendor.email).filter((kind) => kind === "onboarding.account_live")).toHaveLength(1);
    const audit = await query<{ action: string }>(
      "SELECT action FROM audit_log_entries WHERE vendor_id = $1 AND action IN ('vendor.activation_due', 'activation.checkout_started', 'activation.paid', 'vendor.activated') ORDER BY sequence",
      [vendor.vendorId],
    );
    expect(audit.map((entry) => entry.action)).toEqual(["vendor.activation_due", "activation.checkout_started", "vendor.activated", "activation.paid"]);

    await http().post("/v1/vendor/products").set(as(vendor.token)).send(PRODUCT).expect(201);
  });

  it("charges the fee in force when checkout starts, and removing the fee makes waiting vendors live", async () => {
    const vendor = await awaitingActivation("owner@waiting.example");
    const first = await http().post("/v1/vendor/activation/checkout").set(as(vendor.token)).expect(201);

    await setFee(superAdmin, "GB", 500).expect(200);
    expect((await activation(vendor)).feeMinor).toBe(500);
    const second = await http().post("/v1/vendor/activation/checkout").set(as(vendor.token)).expect(201);
    const fees = await query<{ id: string; fee_minor: string }>("SELECT id, fee_minor FROM vendor_activation_payments WHERE vendor_id = $1 ORDER BY created_at", [vendor.vendorId]);
    expect(fees).toEqual([
      { id: first.body.paymentId, fee_minor: "800" },
      { id: second.body.paymentId, fee_minor: "500" },
    ]);

    await setFee(superAdmin, "GB", 0).expect(200);
    expect(await vendorStatus(vendor.vendorId)).toBe("ACTIVE");
    expect(test.email.lastTo(vendor.email)!.kind).toBe("onboarding.account_live");

    await http().post(`/v1/vendor/activation/payments/${first.body.paymentId}/sandbox-pay`).set(as(vendor.token)).expect(200);
    const [stray] = await query<{ status: string }>("SELECT status FROM vendor_activation_payments WHERE id = $1", [first.body.paymentId]);
    expect(stray!.status).toBe("REFUNDED");
  });

  it("goes live straight after verification when the agreement was accepted first", async () => {
    await setFee(superAdmin, "GB", 0).expect(200);
    const vendor = await signUp("owner@early.example");
    await acceptAgreement(vendor);
    await verify(vendor);
    expect(await vendorStatus(vendor.vendorId)).toBe("ACTIVE");
    expect(kinds(vendor.email)).not.toContain("onboarding.activation_due");
  });
});
