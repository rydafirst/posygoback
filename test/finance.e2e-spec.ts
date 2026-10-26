import Stripe from "stripe";
import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { ReconciliationService } from "../src/modules/finance/jobs/reconciliation.service";
import { StorageBillingService } from "../src/modules/finance/jobs/storage-billing.service";
import { PaymentAccountsService } from "../src/modules/finance/payments/payment-accounts.service";
import { StripeProcessor } from "../src/modules/finance/payments/stripe.processor";
import { SEED_FEE_SCHEDULES } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const WEBHOOK_SECRET = "whsec_gfnTestOnly";
const stripe = new Stripe("sk_test_gfnTestOnly");

async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

class OfflineStripeProcessor extends StripeProcessor {
  override createCheckout(request: { topUpId: string }) {
    return Promise.resolve({ providerReference: `cs_test_${request.topUpId.replace(/-/g, "")}`, redirectUrl: "https://checkout.stripe.com/c/pay/test" });
  }
}

describe("money", () => {
  let test: TestApp;
  let gbOwner: string;
  let gbVendorId: string;
  let usOwner: string;
  let usVendorId: string;
  let finance: string;
  let superAdmin: string;
  let countryOps: string;

  function signedEvent(type: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
    const payload = JSON.stringify({ id, object: "event", type, api_version: "2025-01-01", created: Math.floor(Date.now() / 1000), data: { object } });
    return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
  }

  function deliver(event: { payload: string; signature: string }) {
    return test.http().post("/v1/webhooks/stripe/US").set("stripe-signature", event.signature).set("content-type", "application/json").send(event.payload);
  }

  async function startStripeTopUp(amountMinor: number) {
    const started = await test.http().post("/v1/vendor/wallet/top-ups").set(as(usOwner)).send({ amountMinor }).expect(201);
    const topUpId = started.body.topUpId as string;
    return { topUpId, grossMinor: started.body.grossMinor as number };
  }

  function paidSession(topUpId: string, grossMinor: number, paymentIntent: string) {
    return {
      id: `cs_test_${topUpId.replace(/-/g, "")}`,
      object: "checkout.session",
      payment_status: "paid",
      amount_total: grossMinor,
      currency: "usd",
      payment_intent: paymentIntent,
      metadata: { topUpId, purpose: "wallet.top_up" },
    };
  }

  async function balance(token: string): Promise<number> {
    return (await test.http().get("/v1/vendor/wallet").set(as(token)).expect(200)).body.balanceMinor as number;
  }

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    test.app.get(PaymentAccountsService).register("US", new OfflineStripeProcessor("sk_test_gfnTestOnly", WEBHOOK_SECRET));
    gbOwner = (await signUpAndVerify(test, "owner@gb.example")).accessToken;
    gbVendorId = (await test.http().get("/v1/auth/me").set(as(gbOwner))).body.vendorId;
    usOwner = (await signUpAndVerify(test, "owner@us.example", "a long enough password", "US")).accessToken;
    usVendorId = (await test.http().get("/v1/auth/me").set(as(usOwner))).body.vendorId;
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    countryOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("top-ups", () => {
    it("grosses up card fees and credits the wallet once the sandbox payment completes", async () => {
      expect(await balance(gbOwner)).toBe(0);
      await test.http().post("/v1/vendor/wallet/top-ups").set(as(gbOwner)).send({ amountMinor: 50 }).expect(400);
      const quote = await test.http().post("/v1/vendor/wallet/top-ups/quote").set(as(gbOwner)).send({ amountMinor: 10_000 }).expect(200);
      expect(quote.body).toEqual({ netMinor: 10_000, grossMinor: 10_503, feeMinor: 503, currency: "GBP" });
      const started = await test.http().post("/v1/vendor/wallet/top-ups").set(as(gbOwner)).send({ amountMinor: 10_000 }).expect(201);
      expect(started.body.redirectUrl).toContain("/wallet/sandbox-checkout?topUp=");
      await test.http().post(`/v1/vendor/wallet/top-ups/${started.body.topUpId}/sandbox-pay`).set(as(usOwner)).expect(404);
      await test.http().post(`/v1/vendor/wallet/top-ups/${started.body.topUpId}/sandbox-pay`).set(as(gbOwner)).expect(200);
      await test.http().post(`/v1/vendor/wallet/top-ups/${started.body.topUpId}/sandbox-pay`).set(as(gbOwner)).expect(200);
      expect(await balance(gbOwner)).toBe(10_000);
      expect(test.email.lastTo("owner@gb.example")!.subject).toBe("Your top-up has arrived");
    });

    it("credits a Stripe top-up only from a signed event that matches the checkout", async () => {
      const started = await test.http().post("/v1/vendor/wallet/top-ups").set(as(usOwner)).send({ amountMinor: 20_000 }).expect(201);
      const topUpId = started.body.topUpId as string;
      const session = paidSession(topUpId, started.body.grossMinor, "pi_test_1");

      const forged = signedEvent("checkout.session.completed", session);
      await test.http().post("/v1/webhooks/stripe/US").set("stripe-signature", "t=1,v1=bad").set("content-type", "application/json").send(forged.payload).expect(400);

      await deliver(signedEvent("checkout.session.completed", { ...session, amount_total: 1 })).expect(200);
      expect(await balance(usOwner)).toBe(0);

      const genuine = signedEvent("checkout.session.completed", session, "evt_paid_once");
      await deliver(genuine).expect(200);
      await deliver(genuine).expect(200);
      await deliver(signedEvent("checkout.session.completed", session)).expect(200);
      expect(await balance(usOwner)).toBe(20_000);
      const events = await query<{ outcome: string }>("SELECT outcome FROM payment_events WHERE provider = 'STRIPE' ORDER BY received_at");
      expect(events.map((event) => event.outcome)).toEqual(["rejected: amount or currency does not match", "credited", "already settled"]);
    });

    it("takes refunds back out of the wallet in proportion, without going negative", async () => {
      const [topUp] = await query<{ gross_minor: string }>("SELECT gross_minor FROM top_ups WHERE vendor_id = $1 AND status = 'SUCCEEDED'", [usVendorId]);
      const gross = Number(topUp!.gross_minor);
      const half = Math.floor(gross / 2);
      await deliver(signedEvent("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_test_1", amount_refunded: half, currency: "usd" })).expect(200);
      expect(await balance(usOwner)).toBe(20_000 - Math.floor((half * 20_000) / gross));
      await deliver(signedEvent("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_test_1", amount_refunded: half, currency: "usd" })).expect(200);
      expect(await balance(usOwner)).toBe(20_000 - Math.floor((half * 20_000) / gross));
    });

    it("freezes the wallet when a payment is disputed", async () => {
      await deliver(signedEvent("charge.dispute.created", { id: "dp_1", object: "dispute", payment_intent: "pi_test_1", amount: 100, currency: "usd", status: "needs_response" })).expect(200);
      const wallet = await test.http().get("/v1/vendor/wallet").set(as(usOwner)).expect(200);
      expect(wallet.body.status).toBe("FROZEN");
      expect(test.email.lastTo("owner@us.example")!.subject).toBe("Your wallet has been paused");
    });

    it("still takes back a lost dispute while the wallet is paused, counting earlier refunds", async () => {
      const [topUp] = await query<{ gross_minor: string; refunded_minor: string }>("SELECT gross_minor, refunded_minor FROM top_ups WHERE provider_payment_id = 'pi_test_1'");
      const remaining = Number(topUp!.gross_minor) - Number(topUp!.refunded_minor);
      await deliver(signedEvent("charge.dispute.closed", { id: "dp_1", object: "dispute", payment_intent: "pi_test_1", amount: remaining, currency: "usd", status: "lost" })).expect(200);
      expect(await balance(usOwner)).toBe(0);
      const [settled] = await query<{ status: string }>("SELECT status FROM top_ups WHERE provider_payment_id = 'pi_test_1'");
      expect(settled!.status).toBe("REFUNDED");
    });

    it("doesn't pause the wallet again when a dispute is won", async () => {
      const walletId = (await test.http().get("/v1/vendor/wallet").set(as(usOwner))).body.id as string;
      const { topUpId, grossMinor } = await startStripeTopUp(5_000);
      await deliver(signedEvent("checkout.session.completed", paidSession(topUpId, grossMinor, "pi_test_2"))).expect(200);
      await deliver(signedEvent("charge.dispute.created", { id: "dp_2", object: "dispute", payment_intent: "pi_test_2", amount: grossMinor, currency: "usd", status: "needs_response" })).expect(200);
      await test.http().post(`/v1/admin/finance/wallets/${walletId}/status`).set(as(superAdmin)).send({ frozen: false, reason: "Evidence submitted, card owner confirmed" }).expect(200);
      await deliver(signedEvent("charge.dispute.closed", { id: "dp_2", object: "dispute", payment_intent: "pi_test_2", amount: grossMinor, currency: "usd", status: "won" })).expect(200);
      expect((await test.http().get("/v1/vendor/wallet").set(as(usOwner))).body).toMatchObject({ status: "ACTIVE", balanceMinor: 5_000 });
    });

    it("asks Stripe to resend a refund that arrives before its payment", async () => {
      const { topUpId, grossMinor } = await startStripeTopUp(3_000);
      const early = signedEvent("charge.refunded", { id: "ch_3", object: "charge", payment_intent: "pi_test_3", amount_refunded: grossMinor, currency: "usd" }, "evt_early_refund");
      await deliver(early).expect(503);
      expect(await query("SELECT 1 FROM payment_events WHERE event_id = 'evt_early_refund'")).toHaveLength(0);
      await deliver(signedEvent("checkout.session.completed", paidSession(topUpId, grossMinor, "pi_test_3"))).expect(200);
      expect(await balance(usOwner)).toBe(8_000);
      await deliver(early).expect(200);
      expect(await balance(usOwner)).toBe(5_000);
    });
  });

  describe("fee schedules", () => {
    it("needs a second person to approve a price change", async () => {
      const schedule = { ...SEED_FEE_SCHEDULES.GB!, returnsHandlingMinor: 750 };
      await test.http().post("/v1/admin/fee-schedules/GB").set(as(gbOwner)).send({ schedule, note: "Vendors can't do this" }).expect(404);
      const proposed = await test.http().post("/v1/admin/fee-schedules/GB").set(as(finance)).send({ schedule, note: "Returns cost more to handle now" }).expect(201);
      expect(proposed.body).toMatchObject({ version: 2, status: "PROPOSED" });
      await test.http().post("/v1/admin/fee-schedules/GB").set(as(superAdmin)).send({ schedule, note: "A second change at once" }).expect(409);
      await test.http().post(`/v1/admin/fee-schedules/decisions/${proposed.body.id}`).set(as(finance)).send({ approve: true, note: "Approving my own change" }).expect(403);
      await test.http().post(`/v1/admin/fee-schedules/decisions/${proposed.body.id}`).set(as(superAdmin)).send({ approve: true, note: "Checked against the cost sheet" }).expect(200);
      const history = (await test.http().get("/v1/admin/fee-schedules/GB").set(as(finance)).expect(200)).body as Array<{ version: number; status: string }>;
      expect(history.map((entry) => [entry.version, entry.status])).toEqual([
        [2, "ACTIVE"],
        [1, "SUPERSEDED"],
      ]);
      const vendorView = await test.http().get("/v1/vendor/fees").set(as(gbOwner)).expect(200);
      expect(vendorView.body.schedule.returnsHandlingMinor).toBe(750);
      expect(vendorView.body.schedule).not.toHaveProperty("adjustments");
    });

    it("shows country staff only their own market's prices", async () => {
      await test.http().get("/v1/admin/fee-schedules/GB").set(as(countryOps)).expect(200);
      await test.http().get("/v1/admin/fee-schedules/US").set(as(countryOps)).expect(404);
    });
  });

  describe("adjustments", () => {
    let walletId: string;

    beforeAll(async () => {
      walletId = (await test.http().get("/v1/vendor/wallet").set(as(gbOwner))).body.id;
    });

    it("applies small adjustments straight away and holds large ones for a second person", async () => {
      const small = await test
        .http()
        .post(`/v1/admin/finance/wallets/${walletId}/adjustments`)
        .set(as(finance))
        .send({ direction: "CREDIT", amountMinor: 2_000, reason: "Goodwill for a late delivery" })
        .expect(201);
      expect(small.body.status).toBe("APPLIED");
      const large = await test
        .http()
        .post(`/v1/admin/finance/wallets/${walletId}/adjustments`)
        .set(as(finance))
        .send({ direction: "CREDIT", amountMinor: 60_000, reason: "Compensation for lost stock" })
        .expect(201);
      expect(large.body.status).toBe("PENDING_APPROVAL");
      expect(await balance(gbOwner)).toBe(12_000);
      await test.http().post(`/v1/admin/finance/adjustments/${large.body.id}/decision`).set(as(finance)).send({ approve: true, note: "Self approval" }).expect(403);
      await test.http().post(`/v1/admin/finance/adjustments/${large.body.id}/decision`).set(as(superAdmin)).send({ approve: true, note: "Matches the claim" }).expect(200);
      await test.http().post(`/v1/admin/finance/adjustments/${large.body.id}/decision`).set(as(superAdmin)).send({ approve: true, note: "Twice" }).expect(409);
      expect(await balance(gbOwner)).toBe(72_000);
    });

    it("refuses debits beyond the balance and caps what one person adjusts in a day", async () => {
      await test
        .http()
        .post(`/v1/admin/finance/wallets/${walletId}/adjustments`)
        .set(as(superAdmin))
        .send({ direction: "DEBIT", amountMinor: 900_000, reason: "Far more than the wallet holds" })
        .expect(201);
      const pending = (await test.http().get("/v1/admin/finance/adjustments?status=PENDING_APPROVAL").set(as(finance)).expect(200)).body as Array<{ id: string }>;
      await test.http().post(`/v1/admin/finance/adjustments/${pending[0]!.id}/decision`).set(as(finance)).send({ approve: true, note: "Try it" }).expect(409);
      const capped = await test
        .http()
        .post(`/v1/admin/finance/wallets/${walletId}/adjustments`)
        .set(as(finance))
        .send({ direction: "CREDIT", amountMinor: 990_000, reason: "Over the daily limit" })
        .expect(403);
      expect(capped.body.code).toBe("daily_limit_reached");
      await test.http().post(`/v1/admin/finance/wallets/${walletId}/adjustments`).set(as(gbOwner)).send({ direction: "CREDIT", amountMinor: 100, reason: "Vendors can't adjust" }).expect(404);
    });
  });

  describe("storage billing and integrity", () => {
    async function addBoxes(vendorId: string, count: number, due: string) {
      const [warehouse] = await query<{ id: string }>(
        `INSERT INTO warehouses (country_code, code, name, address_lines, city, postal_code) VALUES ('GB', $1, 'Billing test', '["x"]', 'x', 'x') RETURNING id`,
        [`BT-${Math.random().toString(36).slice(2, 8)}`],
      );
      const [user] = await query<{ id: string }>("SELECT id FROM users WHERE vendor_id = $1 LIMIT 1", [vendorId]);
      const [inbound] = await query<{ id: string }>(
        "INSERT INTO inbound_shipments (reference, vendor_id, warehouse_id, country_code, status, shipping_mode, expected_arrival_date, declared_box_counts, created_by) VALUES ($1, $2, $3, 'GB', 'RECEIVED', 'LOOSE', current_date, '{}', $4) RETURNING id",
        [`IN-GB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, vendorId, warehouse!.id, user!.id],
      );
      for (let index = 0; index < count; index += 1) {
        await query("INSERT INTO storage_boxes (vendor_id, warehouse_id, inbound_id, tier, received_at, next_billing_date) VALUES ($1, $2, $3, 'SMALL', now(), $4)", [
          vendorId,
          warehouse!.id,
          inbound!.id,
          due,
        ]);
      }
    }

    it("bills due boxes once per cycle and marks the wallet overdue when it can't pay", async () => {
      const billing = test.app.get(StorageBillingService);
      await addBoxes(gbVendorId, 2, "2026-01-01");
      const before = await balance(gbOwner);
      expect(await billing.run(new Date("2026-01-01T00:00:00Z"))).toMatchObject({ vendorsCharged: 1, boxesBilled: 2 });
      expect(await balance(gbOwner)).toBe(before - 1800);
      expect(await billing.run(new Date("2026-01-01T00:00:00Z"))).toMatchObject({ vendorsCharged: 0, boxesBilled: 0 });
      const [box] = await query<{ next: string }>("SELECT to_char(next_billing_date, 'YYYY-MM-DD') AS next FROM storage_boxes WHERE vendor_id = $1 LIMIT 1", [gbVendorId]);
      expect(box!.next).toBe("2026-01-31");

      const poor = await signUpAndVerify(test, "poor@gb.example");
      const poorVendor = (await test.http().get("/v1/auth/me").set(as(poor.accessToken))).body.vendorId as string;
      await fundWallet(poorVendor, 100);
      await addBoxes(poorVendor, 1, "2026-01-01");
      expect(await billing.run(new Date("2026-01-01T00:00:00Z"))).toMatchObject({ vendorsOverdue: 1 });
      expect((await test.http().get("/v1/vendor/wallet").set(as(poor.accessToken))).body.status).toBe("STORAGE_OVERDUE");
      expect(test.email.lastTo("poor@gb.example")!.subject).toContain("storage fee");
      await fundWallet(poorVendor, 5_000);
      await billing.run(new Date("2026-01-02T00:00:00Z"));
      const settled = (await test.http().get("/v1/vendor/wallet").set(as(poor.accessToken))).body;
      expect(settled).toMatchObject({ status: "ACTIVE", balanceMinor: 5_100 - 900 });
    });

    it("only changes balances through the append-only ledger, and reconciles clean", async () => {
      await expect(query("UPDATE wallets SET balance_minor = 999999")).rejects.toThrow(/only through ledger entries/);
      await expect(query("UPDATE ledger_entries SET amount_minor = 1")).rejects.toThrow(/append-only/);
      const [wallet] = await query<{ id: string; vendor_id: string; balance_minor: string }>("SELECT id, vendor_id, balance_minor FROM wallets LIMIT 1");
      await expect(
        query(
          "INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) VALUES ($1, $2, 'DEPOSIT', 100, 99999999, 'Made up', 'forged')",
          [wallet!.id, wallet!.vendor_id],
        ),
      ).rejects.toThrow(/does not follow/);
      await expect(
        query(
          "INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) VALUES ($1, $2, 'STORAGE', 100, $3, 'Wrong sign', 'wrong-sign')",
          [wallet!.id, wallet!.vendor_id, Number(wallet!.balance_minor) + 100],
        ),
      ).rejects.toThrow(/sign_matches_type/);
      const report = await test.app.get(ReconciliationService).run();
      expect(report.mismatches).toEqual([]);
      expect(report.walletsChecked).toBeGreaterThanOrEqual(3);
    });

    it("keeps wallets private to their owner and finance", async () => {
      const member = await test.http().get("/v1/admin/finance/wallets").set(as(gbOwner)).expect(404);
      expect(member.body.code).toBe("not_found");
      const listed = (await test.http().get("/v1/admin/finance/wallets?countryCode=US").set(as(finance)).expect(200)).body as Array<{ vendorId: string }>;
      expect(listed.map((wallet) => wallet.vendorId)).toEqual([usVendorId]);
    });
  });
});
