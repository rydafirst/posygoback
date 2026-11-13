import { PartnerPayoutAccountService } from "../src/modules/partners/portal/partner-payout-account.service";
import { insertLegalDocument, resetDatabase, startApp, type TestApp } from "./harness";
import { PartnerFlow, query } from "./partner-helpers";

describe("closing a former partner's payout account", () => {
  let test: TestApp;
  let partnerId: string;

  const accountStatus = async () => (await query<{ status: string }>("SELECT status FROM partner_payout_accounts WHERE partner_id = $1", [partnerId]))[0]?.status;
  const post = (key: string, type: string, bucket: string, amountMinor: number) =>
    query("INSERT INTO partner_ledger_entries (partner_id, currency, type, bucket, amount_minor, description, idempotency_key, release_on) VALUES ($1, 'GBP', $2, $3, $4, 'Test entry', $5, $6)", [
      partnerId,
      type,
      bucket,
      amountMinor,
      key,
      bucket === "HELD" && amountMinor > 0 ? "2027-01-12" : null,
    ]);
  const closeSettled = () => test.app.get(PartnerPayoutAccountService).closeSettled();

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    const flow = new PartnerFlow(test);
    const applied = await flow.apply("leaving@partner.test", "Tunde Bello");
    partnerId = applied.partnerId;
    await flow.completeSteps(applied.token, "Tunde Bello");
    await post("earned", "FULFILMENT", "AVAILABLE", 1_000);
    await post("held", "HOLDBACK", "HELD", 250);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it("leaves the account of a partner who is still open", async () => {
    expect(await closeSettled()).toBe(0);
    expect(await accountStatus()).toBe("ACTIVE");
  });

  it("waits while a closed partner is still owed money", async () => {
    await query("UPDATE fulfilment_partners SET status = 'REJECTED' WHERE id = $1", [partnerId]);
    expect(await closeSettled()).toBe(0);
    await post("released-out", "HOLDBACK_RELEASE", "HELD", -250);
    await post("released-in", "HOLDBACK_RELEASE", "AVAILABLE", 250);
    expect(await closeSettled()).toBe(0);
    expect(await accountStatus()).toBe("ACTIVE");
  });

  it("disconnects the account once the last payout has gone, and only once", async () => {
    await post("paid", "PAYOUT", "AVAILABLE", -1_250);
    expect(await closeSettled()).toBe(1);
    expect(await accountStatus()).toBe("CLOSED");
    expect(await closeSettled()).toBe(0);
    const [audit] = await query("SELECT action FROM audit_log_entries WHERE resource_id = $1 AND action = 'partner.payout_account_closed'", [partnerId]);
    expect(audit).toBeDefined();
  });
});
