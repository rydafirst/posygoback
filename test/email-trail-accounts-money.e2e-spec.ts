import Stripe from "stripe";

import { StorageBillingService } from "../src/modules/finance/jobs/storage-billing.service";
import { PaymentAccountsService } from "../src/modules/finance/payments/payment-accounts.service";
import { StripeProcessor } from "../src/modules/finance/payments/stripe.processor";
import { ReferralRewardsService } from "../src/modules/growth/referral-rewards.service";
import { ReferralsService } from "../src/modules/growth/referrals.service";
import {
  acceptStaffInvitation,
  codeFrom,
  createStaff,
  flushRateLimits,
  fundWallet,
  insertLegalDocument,
  invitationToken,
  makeVendorTrade,
  resetDatabase,
  seedStock,
  signUpAndVerify,
  startApp,
  type TestApp,
  testSignature,
  uploadVerifiedFile,
} from "./harness";
import { application, as, query } from "./partner-helpers";

const WEBHOOK_SECRET = "whsec_gfnTestOnly";
const stripe = new Stripe("sk_test_gfnTestOnly");
const SIGN_UP = ["auth.verify_email", "auth.welcome"];

const ANSWERS = {
  businessType: "LIMITED_COMPANY",
  legalBusinessName: "Trail Hair Co Ltd",
  registrationCountryCode: "GB",
  companyNumber: "12345678",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postalCode: "M1 1AA" },
  contactFullName: "Ada Trail",
  contactRole: "Director",
  contactPhone: "+447700900123",
  productsDescription: "Human hair wigs and extensions",
  monthlyUnits: "UP_TO_1000",
  monthlyOrders: "UP_TO_500",
  hazards: ["NONE"],
};

class OfflineStripeProcessor extends StripeProcessor {
  override createCheckout(request: { topUpId: string }) {
    return Promise.resolve({ providerReference: `cs_test_${request.topUpId.replace(/-/g, "")}`, redirectUrl: "https://checkout.stripe.com/c/pay/test" });
  }
}

describe("email trail: accounts and money", () => {
  let test: TestApp;
  let superAdmin: string;
  let finance: string;
  let compliance: string;
  let warehouseId: string;

  const http = () => test.http();
  const kinds = (email: string) => test.email.sent.filter((message) => message.to === email).map((message) => message.kind);
  const vendorIdOf = async (token: string) => (await http().get("/v1/auth/me").set(as(token)).expect(200)).body.vendorId as string;
  const walletIdOf = async (token: string) => (await http().get("/v1/vendor/wallet").set(as(token)).expect(200)).body.id as string;

  async function submitVerification(token: string): Promise<void> {
    const documents = { businessDocument: await uploadVerifiedFile(test, token) };
    await http()
      .put("/v1/vendor/verification")
      .set(as(token))
      .send({ ...ANSWERS, documents })
      .expect(200);
    const view = await http().get("/v1/vendor/verification").set(as(token)).expect(200);
    if (!view.body.identityCheck) {
      await http().post("/v1/vendor/verification/identity/session").set(as(token)).expect(200);
      await http().post("/v1/vendor/verification/identity/refresh").set(as(token)).expect(200);
    }
    await http().post("/v1/vendor/verification/submit").set(as(token)).expect(200);
  }

  async function acceptAgreement(token: string): Promise<void> {
    const [current] = (await http().get("/v1/vendor/agreements").set(as(token)).expect(200)).body as Array<{ document: { id: string } }>;
    await http().post(`/v1/vendor/agreements/${current!.document.id}/accept`).set(as(token)).send({ signature: testSignature() }).expect(200);
  }

  const decide = (vendorId: string, decision: string, reason?: string) => http().post(`/v1/admin/verifications/${vendorId}/decision`).set(as(compliance)).send({ decision, reason }).expect(200);

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    test.app.get(PaymentAccountsService).register("US", new OfflineStripeProcessor("sk_test_gfnTestOnly", WEBHOOK_SECRET));
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    [{ id: warehouseId }] = (await query<{ id: string }>(
      `INSERT INTO warehouses (country_code, code, name, address_lines, city, postal_code) VALUES ('GB', 'TRAIL-1', 'Trail hub', '["Unit 1"]', 'Manchester', 'M1 1AA') RETURNING id`,
    )) as [{ id: string }];
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("business verification", () => {
    it("confirms each submission, asks for changes, and points to the agreement once approved", async () => {
      const owner = (await signUpAndVerify(test, "owner@verify.example")).accessToken;
      const vendorId = await vendorIdOf(owner);
      await submitVerification(owner);
      await decide(vendorId, "REQUEST_RESUBMISSION", "The selfie is blurry, please retake it in good light.");
      const changes = test.email.lastTo("owner@verify.example")!;
      expect(changes.text).toContain("selfie is blurry");
      expect(changes.action).toEqual({ label: "Update your verification", url: "http://localhost:3000/verification" });
      await submitVerification(owner);
      await decide(vendorId, "APPROVE");
      expect(kinds("owner@verify.example")).toEqual([
        ...SIGN_UP,
        "onboarding.verification_submitted",
        "onboarding.verification_changes_needed",
        "onboarding.verification_submitted",
        "onboarding.verification_approved",
      ]);
      expect(test.email.lastTo("owner@verify.example")!.action).toEqual({ label: "Accept the vendor agreement", url: "http://localhost:3000/verification" });
    });

    it("tells a vendor who already accepted the agreement they can start sending stock", async () => {
      const owner = (await signUpAndVerify(test, "ready@verify.example")).accessToken;
      await acceptAgreement(owner);
      await submitVerification(owner);
      await decide(await vendorIdOf(owner), "APPROVE");
      const approved = test.email.lastTo("ready@verify.example")!;
      expect(approved.text).toContain("you can start sending stock");
      expect(approved.action).toEqual({ label: "Open your dashboard", url: "http://localhost:3000/overview" });
    });

    it("explains a rejection without a button", async () => {
      const owner = (await signUpAndVerify(test, "refused@verify.example")).accessToken;
      await submitVerification(owner);
      await decide(await vendorIdOf(owner), "REJECT", "We couldn't match the company number to the business name.");
      expect(kinds("refused@verify.example")).toEqual([...SIGN_UP, "onboarding.verification_submitted", "onboarding.verification_rejected"]);
      expect(test.email.lastTo("refused@verify.example")!.action).toBeUndefined();
    });
  });

  describe("vendor team", () => {
    it("invites, tells the owner when someone joins, and tells the member when they're removed", async () => {
      const owner = (await signUpAndVerify(test, "owner@team.example")).accessToken;
      await http().post("/v1/vendor/team/invitations").set(as(owner)).send({ email: "member@team.example" }).expect(202);
      const invitation = test.email.lastTo("member@team.example")!;
      expect(invitation.action!.url).toMatch(/^http:\/\/localhost:3000\/invite#token=/);
      const accepted = await http()
        .post("/v1/invitations/accept")
        .send({ token: invitationToken(test, "member@team.example"), password: "a member's own password" })
        .expect(200);
      const joined = test.email.lastTo("owner@team.example")!;
      expect(joined.subject).toBe("member@team.example has joined your team");
      expect(joined.action).toEqual({ label: "View your team", url: "http://localhost:3000/settings/team" });
      await http().delete(`/v1/vendor/team/members/${accepted.body.user.id}`).set(as(owner)).expect(204);
      await http().delete(`/v1/vendor/team/members/${accepted.body.user.id}`).set(as(owner)).expect(204);
      expect(kinds("owner@team.example")).toEqual([...SIGN_UP, "onboarding.team_member_joined"]);
      expect(kinds("member@team.example")).toEqual(["onboarding.team_invitation", "onboarding.team_member_removed"]);
      expect(test.email.lastTo("member@team.example")!.subject).toBe("You've been removed from Acme Goods");
    });
  });

  describe("platform staff", () => {
    it("invites a staff member and tells them when their account is suspended", async () => {
      await http().post("/v1/admin/staff/invitations").set(as(superAdmin)).send({ email: "new-staff@gfn.test", role: "COMPLIANCE" }).expect(202);
      expect(test.email.lastTo("new-staff@gfn.test")!.action!.label).toBe("Accept the invitation");
      const token = await acceptStaffInvitation(test, "new-staff@gfn.test");
      const userId = (await http().get("/v1/auth/me").set(as(token)).expect(200)).body.id as string;
      await http().post(`/v1/admin/staff/members/${userId}/suspend`).set(as(superAdmin)).expect(204);
      expect(kinds("new-staff@gfn.test")).toEqual(["staff.invitation", "auth.mfa_enrolment_code", "auth.mfa_enabled", "staff.account_suspended"]);
      expect(test.email.lastTo("new-staff@gfn.test")!.subject).toBe("Your Posygo account has been suspended");
    });

    it("starts a partner application with a set-up link", async () => {
      await http().post("/v1/public/partner-applications").send(application("applicant@partner.test", "Bisi Applicant")).expect(202);
      expect(kinds("applicant@partner.test")[0]).toBe("staff.partner_application");
      expect(test.email.lastTo("applicant@partner.test")!.action!.url).toMatch(/^http:\/\/localhost:3000\/staff-invite#token=/);
      const token = decodeURIComponent(test.email.lastTo("applicant@partner.test")!.action!.url.split("#token=")[1]!);
      const preview = await http().post("/v1/staff-invitations/preview").send({ token }).expect(200);
      expect(preview.body).toMatchObject({ role: "FULFILMENT_PARTNER", partnerName: "Bisi Applicant", purpose: "PARTNER_APPLICATION" });
    });
  });

  describe("wallet", () => {
    it("emails for a top-up, each manual credit or debit, a low balance, and a pause and unpause", async () => {
      const owner = (await signUpAndVerify(test, "owner@wallet.example")).accessToken;
      const started = await http().post("/v1/vendor/wallet/top-ups").set(as(owner)).send({ amountMinor: 10_000 }).expect(201);
      await http().post(`/v1/vendor/wallet/top-ups/${started.body.topUpId}/sandbox-pay`).set(as(owner)).expect(200);
      expect(test.email.lastTo("owner@wallet.example")!.action).toEqual({ label: "View your wallet", url: "http://localhost:3000/wallet" });

      const walletId = await walletIdOf(owner);
      const adjust = (direction: string, amountMinor: number, reason: string) =>
        http().post(`/v1/admin/finance/wallets/${walletId}/adjustments`).set(as(finance)).send({ direction, amountMinor, reason }).expect(201);
      await adjust("CREDIT", 2_000, "Goodwill for a late delivery");
      const credit = test.email.lastTo("owner@wallet.example")!;
      expect(credit.subject).toBe("£20.00 wallet credit added");
      expect(credit.text).toContain("Reason: Goodwill for a late delivery");
      expect(credit.text).toContain("Your balance is now £120.00.");
      await adjust("DEBIT", 8_000, "Duplicate goodwill credit reversed");
      const large = await adjust("CREDIT", 60_000, "Wallet credit for lost stock");
      const declined = await adjust("CREDIT", 55_000, "Entered twice by mistake");
      await http().post(`/v1/admin/finance/adjustments/${declined.body.id}/decision`).set(as(superAdmin)).send({ approve: false, note: "Duplicate request" }).expect(200);
      await http().post(`/v1/admin/finance/adjustments/${large.body.id}/decision`).set(as(superAdmin)).send({ approve: true, note: "Matches the claim" }).expect(200);

      await http().post(`/v1/admin/finance/wallets/${walletId}/status`).set(as(finance)).send({ frozen: true, reason: "Checking unusual activity" }).expect(200);
      await http().post(`/v1/admin/finance/wallets/${walletId}/status`).set(as(finance)).send({ frozen: true, reason: "Pressed twice" }).expect(200);
      await http().post(`/v1/admin/finance/wallets/${walletId}/status`).set(as(finance)).send({ frozen: false, reason: "All checked" }).expect(200);

      expect(kinds("owner@wallet.example")).toEqual([
        ...SIGN_UP,
        "finance.top_up_received",
        "finance.wallet_credited",
        "finance.wallet_debited",
        "finance.low_balance",
        "finance.wallet_credited",
        "finance.wallet_paused_manually",
        "finance.wallet_unpaused",
      ]);
    });

    it("emails when storage can't be taken", async () => {
      const owner = (await signUpAndVerify(test, "skint@wallet.example")).accessToken;
      const vendorId = await vendorIdOf(owner);
      await fundWallet(vendorId, 100);
      const [user] = await query<{ id: string }>("SELECT id FROM users WHERE vendor_id = $1", [vendorId]);
      const [inbound] = await query<{ id: string }>(
        "INSERT INTO inbound_shipments (reference, vendor_id, warehouse_id, country_code, status, shipping_mode, expected_arrival_date, declared_box_counts, created_by) VALUES ('IN-GB-SKINT1', $1, $2, 'GB', 'RECEIVED', 'LOOSE', current_date, '{}', $3) RETURNING id",
        [vendorId, warehouseId, user!.id],
      );
      await query("INSERT INTO storage_boxes (vendor_id, warehouse_id, inbound_id, tier, received_at, next_billing_date) VALUES ($1, $2, $3, 'SMALL', now(), '2026-01-01')", [
        vendorId,
        warehouseId,
        inbound!.id,
      ]);
      await test.app.get(StorageBillingService).run(new Date("2026-01-01T00:00:00Z"));
      expect(kinds("skint@wallet.example")).toEqual([...SIGN_UP, "finance.storage_overdue"]);
      expect(test.email.lastTo("skint@wallet.example")!.action).toEqual({ label: "Top up your wallet", url: "http://localhost:3000/wallet" });
    });

    it("emails when a card top-up is refunded and when a dispute pauses the wallet", async () => {
      const owner = (await signUpAndVerify(test, "owner@cards.example", "a long enough password", "US")).accessToken;
      const signed = (type: string, object: Record<string, unknown>) => {
        const payload = JSON.stringify({
          id: `evt_${Math.random().toString(36).slice(2)}`,
          object: "event",
          type,
          api_version: "2025-01-01",
          created: Math.floor(Date.now() / 1000),
          data: { object },
        });
        return http()
          .post("/v1/webhooks/stripe/US")
          .set("stripe-signature", stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }))
          .set("content-type", "application/json")
          .send(payload)
          .expect(200);
      };
      const started = await http().post("/v1/vendor/wallet/top-ups").set(as(owner)).send({ amountMinor: 20_000 }).expect(201);
      const { topUpId, grossMinor } = started.body as { topUpId: string; grossMinor: number };
      await signed("checkout.session.completed", {
        id: `cs_test_${topUpId.replace(/-/g, "")}`,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: grossMinor,
        currency: "usd",
        payment_intent: "pi_trail_1",
        metadata: { topUpId, purpose: "wallet.top_up" },
      });
      await signed("charge.refunded", { id: "ch_trail", object: "charge", payment_intent: "pi_trail_1", amount_refunded: Math.floor(grossMinor / 2), currency: "usd" });
      expect(test.email.lastTo("owner@cards.example")!.text).toContain("was refunded");
      await signed("charge.dispute.created", { id: "dp_trail", object: "dispute", payment_intent: "pi_trail_1", amount: 100, currency: "usd", status: "needs_response" });
      expect(kinds("owner@cards.example")).toEqual([...SIGN_UP, "finance.top_up_received", "finance.payment_reversed", "finance.wallet_paused"]);
    });
  });

  describe("referrals", () => {
    it("credits both businesses with different emails once the new one's first stock arrives", async () => {
      const referrer = (await signUpAndVerify(test, "referrer@growth.example")).accessToken;
      await makeVendorTrade(await vendorIdOf(referrer));
      const code = (await http().get("/v1/vendor/referrals").set(as(referrer)).expect(200)).body.code as string;
      await http()
        .post("/v1/auth/signup")
        .send({ email: "joiner@growth.example", password: "a long enough password", businessName: "New Seller", countryCodes: ["GB"], acceptTerms: true, referralCode: code })
        .expect(202);
      const joined = await http()
        .post("/v1/auth/verify-email")
        .send({ email: "joiner@growth.example", code: codeFrom(test.email.lastTo("joiner@growth.example")!.text), password: "a long enough password" })
        .expect(200);
      const joinerId = await vendorIdOf(joined.body.accessToken as string);
      await test.app.get(ReferralsService).attributePending();
      await makeVendorTrade(joinerId);
      const product = (
        await http()
          .post("/v1/vendor/products")
          .set(as(joined.body.accessToken as string))
          .send({ countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL", code: "wig-1", name: "Body wave wig", barcodes: [{ value: "WIG-1", symbology: "CODE128" }] })
          .expect(201)
      ).body.id as string;
      await seedStock({ vendorId: joinerId, productId: product, warehouseId, quantity: 1 });
      await test.app.get(ReferralRewardsService).rewardDue();
      expect(kinds("referrer@growth.example")).toEqual([...SIGN_UP, "referral.reward_credited"]);
      expect(kinds("joiner@growth.example")).toEqual([...SIGN_UP, "referral.welcome_credit"]);
      expect(test.email.lastTo("joiner@growth.example")!.subject).toBe("£10.00 welcome credit added to your wallet");
      expect(test.email.lastTo("referrer@growth.example")!.action).toEqual({ label: "See your referrals", url: "http://localhost:3000/settings/referrals" });
    });
  });
});
