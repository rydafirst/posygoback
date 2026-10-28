import { ReferralRewardsService } from "../src/modules/growth/referral-rewards.service";
import { ReferralsService } from "../src/modules/growth/referrals.service";
import type { ReferralCampaignView, ReferralRowView, VendorReferralView } from "../src/shared";
import { codeFrom, createStaff, flushRateLimits, insertLegalDocument, makeVendorTrade, resetDatabase, seedStock, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

describe("referrals and campaigns", () => {
  let test: TestApp;
  let referrer: string;
  let referrerId: string;
  let referred: string;
  let referredId: string;
  let finance: string;
  let countryOps: string;
  let warehouseId: string;
  let code = "";

  const http = () => test.http();
  const signUpWith = async (email: string, referralCode: string, countryCode = "GB") => {
    await http()
      .post("/v1/auth/signup")
      .send({ email, password: "a long enough password", businessName: "New Seller", countryCodes: [countryCode], acceptTerms: true, referralCode })
      .expect(202);
    const verified = await http()
      .post("/v1/auth/verify-email")
      .send({ email, code: codeFrom(test.email.lastTo(email)!.text), password: "a long enough password" })
      .expect(200);
    const token = verified.body.accessToken as string;
    return { token, vendorId: (await http().get("/v1/auth/me").set(as(token))).body.vendorId as string };
  };
  const balance = async (vendorId: string) => Number((await query<{ balance_minor: string }>("SELECT balance_minor FROM wallets WHERE vendor_id = $1", [vendorId]))[0]?.balance_minor ?? 0);
  const process = () => test.app.get(ReferralsService).attributePending();
  const reward = () => test.app.get(ReferralRewardsService).rewardDue();

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    referrer = (await signUpAndVerify(test, "referrer@growth.example")).accessToken;
    referrerId = (await http().get("/v1/auth/me").set(as(referrer))).body.vendorId;
    await makeVendorTrade(referrerId);
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    countryOps = await createStaff(test, "ops@gfn.test", "COUNTRY_OPS", "GB");
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    warehouseId = (
      await http()
        .post("/v1/warehouse/warehouses")
        .set(as(superAdmin))
        .send({ countryCode: "GB", code: "MAN-1", name: "Manchester", addressLines: ["Unit 4"], city: "Manchester", postalCode: "M17 1AA" })
        .expect(201)
    ).body.id;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("gives every vendor a code and shows what referrals earn", async () => {
    const mine = (await http().get("/v1/vendor/referrals").set(as(referrer)).expect(200)).body as VendorReferralView;
    expect(mine).toMatchObject({ currency: "GBP", referrerCreditMinor: 1_000, refereeCreditMinor: 1_000, joined: 0, rewarded: 0 });
    expect(mine.code).toMatch(/^ACMEGOOD-[A-Z0-9]{4}$/);
    code = mine.code;
    expect(((await http().get("/v1/vendor/referrals").set(as(referrer)).expect(200)).body as VendorReferralView).code).toBe(code);
    await http().get("/v1/vendor/referrals").set(as(finance)).expect(404);
  });

  it("records a signup that used the code, but not one from another country or with a made-up code", async () => {
    ({ token: referred, vendorId: referredId } = await signUpWith("referred@growth.example", code.toLowerCase()));
    await signUpWith("abroad@growth.example", code, "US");
    await signUpWith("unknown@growth.example", "NOPE-1234");
    expect(await process()).toBe(3);
    const rows = await query<{ referred_vendor_id: string; status: string }>("SELECT referred_vendor_id, status::text FROM referrals");
    expect(rows).toEqual([{ referred_vendor_id: referredId, status: "REGISTERED" }]);
    expect(await process()).toBe(0);
  });

  it("credits both wallets once the new vendor is trading and their first stock has arrived", async () => {
    expect(await reward()).toBe(0);
    await makeVendorTrade(referredId);
    expect(await reward()).toBe(0);
    const product = (
      await http()
        .post("/v1/vendor/products")
        .set(as(referred))
        .send({ countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL", code: "wig-1", name: "Body wave wig", barcodes: [{ value: "WIG-1", symbology: "CODE128" }] })
        .expect(201)
    ).body.id;
    await seedStock({ vendorId: referredId, productId: product, warehouseId, quantity: 1 });
    const [before, beforeReferred] = [await balance(referrerId), await balance(referredId)];
    expect(await reward()).toBe(2);
    expect(await balance(referrerId)).toBe(before + 1_000);
    expect(await balance(referredId)).toBe(beforeReferred + 1_000);
    expect(await reward()).toBe(0);
    expect((await http().get("/v1/vendor/referrals").set(as(referrer)).expect(200)).body).toMatchObject({ joined: 1, rewarded: 1, earnedMinor: 1_000 });
    expect(test.email.lastTo("referrer@growth.example")!.subject).toBe("£10.00 referral credit added to your wallet");
    expect(((await http().get("/v1/notifications").set(as(referrer)).expect(200)).body.items as Array<{ href: string }>)[0]!.href).toBe("/settings/referrals");
  });

  it("lets finance run a campaign code that can't clash with vendor codes and stops at its limit", async () => {
    const campaign = { countryCode: "GB", code: "launch-gb", name: "Launch week", refereeCreditMinor: 2_500, maxSignups: 1 };
    await http().post("/v1/admin/referrals/campaigns").set(as(countryOps)).send(campaign).expect(404);
    const created = (await http().post("/v1/admin/referrals/campaigns").set(as(finance)).send(campaign).expect(201)).body as ReferralCampaignView;
    expect(created).toMatchObject({ code: "LAUNCH-GB", signups: 0, active: true });
    expect(
      (
        await http()
          .post("/v1/admin/referrals/campaigns")
          .set(as(finance))
          .send({ ...campaign, code })
          .expect(400)
      ).body.fieldErrors.code[0],
    ).toMatch(/already in use/);
    await signUpWith("first@growth.example", "LAUNCH-GB");
    await signUpWith("second@growth.example", "LAUNCH-GB");
    await process();
    const listed = (await http().get("/v1/admin/referrals").set(as(countryOps)).expect(200)).body as ReferralRowView[];
    const fromCampaign = listed.filter((row) => row.campaignName === "Launch week");
    expect(fromCampaign).toHaveLength(1);
    expect(fromCampaign[0]).toMatchObject({ refereeCreditMinor: 2_500, referrerCreditMinor: 0, status: "REGISTERED" });
    await http().post(`/v1/admin/referrals/${fromCampaign[0]!.id}/void`).set(as(countryOps)).send({ reason: "Duplicate account" }).expect(404);
    await http().post(`/v1/admin/referrals/${fromCampaign[0]!.id}/void`).set(as(finance)).send({ reason: "Duplicate account" }).expect(200);
    const rewarded = listed.find((row) => row.status === "REWARDED")!;
    await http().post(`/v1/admin/referrals/${rewarded.id}/void`).set(as(finance)).send({ reason: "Too late now" }).expect(409);
    expect(((await http().put(`/v1/admin/referrals/campaigns/${created.id}`).set(as(finance)).send({ active: false }).expect(200)).body as ReferralCampaignView).active).toBe(false);
  });
});
