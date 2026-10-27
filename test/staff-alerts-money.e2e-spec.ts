import { StorefrontPayoutsService } from "../src/modules/commerce/orders/storefront-payouts.service";
import { PAYOUT_GATEWAY, type PayoutGateway, TransferError } from "../src/modules/partners/providers/partner-services.port";
import { type NotificationFeedView, SEED_FEE_SCHEDULES } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp, WEB_ORIGIN } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";
import { handOff, type OpenStore, openStore, paidOrder } from "./store-helpers";

const BUYER = "buyer@alerts.example";

describe("staff alerts: money waiting for staff", () => {
  let test: TestApp;
  let store: OpenStore;
  let superAdmin: string;
  let compliance: string;
  let financeA: string;
  let financeB: string;
  let ops: string;

  const http = () => test.http();
  const feed = async (token: string) => ((await http().get("/v1/notifications").set(as(token)).expect(200)).body as NotificationFeedView).items;
  const alertTitled = async (token: string, title: string) => (await feed(token)).find((item) => item.title === title);

  async function signInBuyer(email: string): Promise<string> {
    await http().post("/v1/buyer/auth/link").set("Origin", WEB_ORIGIN).send({ email }).expect(202);
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(test.email.lastTo(email)!.text)![1]!;
    const session = await http().post("/v1/buyer/auth/session").set("Origin", WEB_ORIGIN).send({ token }).expect(200);
    return ([] as string[])
      .concat(session.headers["set-cookie"] ?? [])
      .find((cookie) => cookie.startsWith("gfn_bs="))!
      .split(";")[0]!;
  }

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    const staff = async (email: string, role: string, country: string | null = null) => {
      await flushRateLimits();
      return createStaff(test, email, role, country);
    };
    superAdmin = await staff("super@alerts.test", "SUPER_ADMIN");
    compliance = await staff("compliance@alerts.test", "COMPLIANCE");
    financeA = await staff("finance-a@alerts.test", "FINANCE_ADMIN");
    financeB = await staff("finance-b@alerts.test", "FINANCE_ADMIN");
    ops = await staff("ops@alerts.test", "COUNTRY_OPS", "GB");
    await flushRateLimits();
    store = await openStore(test, "alerts");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("tells approvers, but not the proposer, about a new price list", async () => {
    const schedule = { ...SEED_FEE_SCHEDULES.GB!, returnsHandlingMinor: 750 };
    await http().post("/v1/admin/fee-schedules/GB").set(as(financeA)).send({ schedule, note: "Returns cost more to handle now" }).expect(201);
    const title = "Price list for GB waiting for approval";
    expect(await alertTitled(financeB, title)).toMatchObject({ href: "/admin/fees", body: expect.stringContaining("finance-a@alerts.test") });
    expect(await alertTitled(superAdmin, title)).toMatchObject({ href: "/admin/fees" });
    expect(await alertTitled(financeA, title)).toBeUndefined();
    expect(await alertTitled(ops, title)).toBeUndefined();
  });

  it("tells approvers, but not the requester, about a large wallet adjustment", async () => {
    const walletId = (await http().get("/v1/vendor/wallet").set(as(store.owner)).expect(200)).body.id as string;
    await http().post(`/v1/admin/finance/wallets/${walletId}/adjustments`).set(as(financeA)).send({ direction: "CREDIT", amountMinor: 2_000, reason: "Goodwill for a late delivery" }).expect(201);
    expect((await feed(financeB)).filter((item) => item.href === "/admin/finance")).toHaveLength(0);
    await http().post(`/v1/admin/finance/wallets/${walletId}/adjustments`).set(as(financeA)).send({ direction: "CREDIT", amountMinor: 60_000, reason: "Wallet credit for lost stock" }).expect(201);
    const title = "£600.00 wallet adjustment for Acme Goods to approve";
    expect(await alertTitled(financeB, title)).toMatchObject({ href: "/admin/finance", body: expect.stringContaining("Wallet credit for lost stock") });
    expect(await alertTitled(superAdmin, title)).toMatchObject({ href: "/admin/finance" });
    expect(await alertTitled(financeA, title)).toBeUndefined();
  });

  it("tells approvers, but not the requester, about a partner payout", async () => {
    const partner = await new PartnerFlow(test).onboard("lead@alerts.test", "Ada Obi", compliance, superAdmin);
    await query(
      "INSERT INTO partner_ledger_entries (partner_id, currency, type, bucket, amount_minor, description, idempotency_key) VALUES ($1, 'GBP', 'ADJUSTMENT', 'AVAILABLE', 5000, 'Earnings', 'alerts-earnings')",
      [partner.partnerId],
    );
    await http().post(`/v1/admin/partners/${partner.partnerId}/payouts`).set(as(financeA)).send({ amountMinor: 1_000, note: "Monthly payout" }).expect(201);
    const title = "£10.00 payout for Ada Obi to approve";
    expect(await alertTitled(financeB, title)).toMatchObject({ href: "/admin/partners" });
    expect(await alertTitled(superAdmin, title)).toMatchObject({ href: "/admin/partners" });
    expect(await alertTitled(financeA, title)).toBeUndefined();
    expect(await alertTitled(partner.token, title)).toBeUndefined();
  });

  it("tells staff when a buyer asks to return a store order", async () => {
    const order = await paidOrder(test, store, BUYER);
    await handOff(test, order.id);
    const cookie = await signInBuyer(BUYER);
    await http().post(`/v1/buyer/orders/${order.id}/returns`).set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ reason: "The colour is darker than the photo." }).expect(201);
    const title = `Return requested for order ${order.reference}`;
    expect(await alertTitled(ops, title)).toMatchObject({ href: "/admin/storefront-returns", body: expect.stringContaining("darker than the photo") });
    expect(await alertTitled(financeA, title)).toMatchObject({ href: "/admin/storefront-returns" });
    expect(await alertTitled(compliance, title)).toBeUndefined();
  });

  it("tells finance when a store payout fails", async () => {
    const order = await paidOrder(test, store, "second@alerts.example");
    await handOff(test, order.id);
    await query("UPDATE storefront_orders SET payout_release_at = now() - interval '1 minute' WHERE id = $1", [order.id]);
    const gateway = test.app.get<PayoutGateway>(PAYOUT_GATEWAY);
    jest.spyOn(gateway, "transfer").mockRejectedValueOnce(new TransferError("Account closed", true));
    await test.app.get(StorefrontPayoutsService).releaseDue();
    const [row] = await query<{ payout_status: string }>("SELECT payout_status FROM storefront_orders WHERE id = $1", [order.id]);
    expect(row!.payout_status).toBe("FAILED");
    const title = `Store payout failed for order ${order.reference}`;
    expect(await alertTitled(financeA, title)).toMatchObject({ href: "/admin/storefront-orders" });
    expect(await alertTitled(superAdmin, title)).toMatchObject({ href: "/admin/storefront-orders" });
    expect(await alertTitled(ops, title)).toBeUndefined();
  });
});
