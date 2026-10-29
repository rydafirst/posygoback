import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import { TaxRemindersService } from "../src/modules/tax/tax-reminders.service";
import type { NotificationFeedView, TaxCountryView, TaxObligationView, TaxOverviewView } from "../src/shared";
import { createStaff, flushRateLimits, fundWallet, insertLegalDocument, makeVendorTrade, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("tax and compliance", () => {
  let test: TestApp;
  let finance: string;
  let support: string;
  let vendorId: string;
  const today = new Date().toISOString().slice(0, 10);

  const http = () => test.http();
  const country = async (code: string) => (await http().get(`/v1/admin/tax/countries/${code}`).set(as(finance)).expect(200)).body as TaxCountryView;
  const titled = (view: TaxCountryView, title: string) => view.obligations.find((obligation) => obligation.title === title)!;

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "VENDOR_AGREEMENT", "1.0");
    test = await startApp();
    finance = await createStaff(test, "finance@tax.test", "FINANCE_ADMIN");
    support = await createStaff(test, "admin@tax.test", "ADMIN");
    const owner = (await signUpAndVerify(test, "owner@tax.example")).accessToken;
    vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId;
    await makeVendorTrade(vendorId);
    await fundWallet(vendorId, 50_000);
    const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
    const wallet = (await pool.query<{ id: string }>("SELECT id FROM wallets WHERE vendor_id = $1", [vendorId])).rows[0]!;
    await pool.query("INSERT INTO ledger_entries (wallet_id, vendor_id, type, amount_minor, balance_after_minor, description, idempotency_key) VALUES ($1, $2, 'STORAGE', -2500, 47500, 'Storage', 'tax-test-storage')", [
      wallet.id,
      vendorId,
    ]);
    await pool.end();
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("is only open to finance and super admins", async () => {
    await http().get("/v1/admin/tax").set(as(support)).expect(404);
    await http().get("/v1/admin/tax").expect(401);
    await http().get("/v1/admin/tax/countries/gb").set(as(finance)).expect(400);
  });

  it("adds the UK checklist once, with the platform report due on 31 January", async () => {
    expect((await country("GB")).obligations).toEqual([]);
    const gb = (await http().post("/v1/admin/tax/countries/GB/checklist").set(as(finance)).expect(201)).body as TaxCountryView;
    expect(gb.obligations.map((obligation) => obligation.title)).toEqual(expect.arrayContaining(["Company Tax Return", "VAT return", "Digital platform report", "Fulfilment house approval (FHDDS)"]));
    expect(titled(gb, "Digital platform report").next!.dueOn).toMatch(/-01-31$/);
    expect(titled(gb, "Company Tax Return").next).toBeNull();
    expect(gb.obligations.every((obligation) => !obligation.confirmed)).toBe(true);
    expect(gb.threshold).toMatchObject({ currency: "GBP", limitMinor: 9_000_000, last12MonthsMinor: 2_500 });
    await http().post("/v1/admin/tax/countries/GB/checklist").set(as(finance)).expect(409);

    const us = (await http().post("/v1/admin/tax/countries/US/checklist").set(as(finance)).expect(201)).body as TaxCountryView;
    expect(us.obligations.every((obligation) => obligation.authority === "Your tax adviser" && obligation.next === null)).toBe(true);
  });

  it("sets a due date, files it with a reference and rolls on to the next one", async () => {
    const vat = titled(await country("GB"), "VAT return");
    const scheduled = (await http().post(`/v1/admin/tax/obligations/${vat.id}/deadlines`).set(as(finance)).send({ dueOn: "2026-11-07" }).expect(201)).body as TaxObligationView;
    await http().post(`/v1/admin/tax/obligations/${vat.id}/deadlines`).set(as(finance)).send({ dueOn: "2026-12-07" }).expect(409);
    await http().patch(`/v1/admin/tax/deadlines/${scheduled.next!.id}`).set(as(finance)).send({ dueOn: "2026-11-09" }).expect(200);
    const filed = (await http().post(`/v1/admin/tax/deadlines/${scheduled.next!.id}/file`).set(as(finance)).send({ filedOn: "2026-11-01", reference: "VAT-123" }).expect(201))
      .body as TaxObligationView;
    expect(filed.history[0]).toMatchObject({ dueOn: "2026-11-09", status: "FILED", filedOn: "2026-11-01", reference: "VAT-123" });
    expect(filed.next!.dueOn).toBe("2027-02-09");
    await http().post(`/v1/admin/tax/deadlines/${scheduled.next!.id}/file`).set(as(finance)).send({ filedOn: "2026-11-01" }).expect(409);

    const once = titled(await country("GB"), "Fulfilment house approval (FHDDS)");
    await http().post(`/v1/admin/tax/obligations/${once.id}/deadlines`).set(as(finance)).send({ dueOn: addDays(today, 60) }).expect(201);
    const approved = (await http().post(`/v1/admin/tax/deadlines/${(await country("GB")).obligations.find((o) => o.id === once.id)!.next!.id}/file`).set(as(finance)).send({ filedOn: today }).expect(201))
      .body as TaxObligationView;
    expect(approved.next).toBeNull();

    const updated = (await http().patch(`/v1/admin/tax/obligations/${vat.id}`).set(as(finance)).send({ confirmed: true, owner: "Our accountant" }).expect(200)).body as TaxObligationView;
    expect(updated).toMatchObject({ confirmed: true, owner: "Our accountant" });
    await http().post("/v1/admin/tax/countries/GB/obligations").set(as(finance)).send({ title: "PAYE", authority: "HMRC", description: "Payroll", cadence: "MONTHLY", dueRule: "22nd of each month", firstDueOn: addDays(today, -2) }).expect(201);
  });

  it("shows what's coming up and overdue, on the dashboard too", async () => {
    const overview = (await http().get("/v1/admin/tax").set(as(finance)).expect(200)).body as TaxOverviewView;
    const gb = overview.countries.find((summary) => summary.countryCode === "GB")!;
    expect(gb.overdue).toBe(1);
    expect(overview.upcoming[0]).toMatchObject({ obligationTitle: "PAYE", daysLeft: -2 });
    expect(overview.thresholds.map((threshold) => threshold.countryCode)).toContain("GB");
    const dashboard = (await http().get("/v1/admin/dashboard").set(as(finance)).expect(200)).body as { attention: Array<{ key: string; count: number }> };
    expect(dashboard.attention.find((item) => item.key === "taxDeadlines")?.count).toBe(1);
  });

  it("reminds finance at each step and daily while overdue, once a day", async () => {
    const reminders = test.app.get(TaxRemindersService);
    const emailsBefore = test.email.sent.filter((message) => message.to === "finance@tax.test").length;
    expect(await reminders.send(today)).toBe(1);
    expect(await reminders.send(today)).toBe(0);
    expect(await reminders.send(addDays(today, 1))).toBe(1);
    const feed = (await http().get("/v1/notifications").set(as(finance)).expect(200)).body as NotificationFeedView;
    expect(feed.items[0]!.title).toMatch(/^PAYE \(GB\) is overdue by 3 days$/);
    expect(test.email.sent.filter((message) => message.to === "finance@tax.test").length).toBe(emailsBefore + 2);

    const report = titled(await country("GB"), "Digital platform report");
    const daysOut = report.next!.daysLeft;
    expect(await reminders.send(addDays(report.next!.dueOn, -7))).toBeGreaterThanOrEqual(daysOut > 7 ? 1 : 0);
  });
});
