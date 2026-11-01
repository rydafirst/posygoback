import type { ReminderView } from "../src/shared";
import { RemindersService } from "../src/modules/reminders/reminders.service";
import { codeFrom, createStaff, flushRateLimits, resetDatabase, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const SELLER = "slow@seller.test";

describe("reminder emails", () => {
  let test: TestApp;
  let superAdmin: string;
  let finance: string;
  const run = (daysFromNow: number) => test.app.get(RemindersService).run(new Date(Date.now() + daysFromNow * DAY_MS));
  const reminders = () => test.email.sent.filter((message) => message.to === SELLER && message.kind?.startsWith("reminder."));
  const enable = (key: string, body: Partial<{ enabled: boolean; delaysDays: number[]; subject: string; body: string }> = {}) =>
    test
      .http()
      .patch(`/v1/admin/reminders/${key}`)
      .set(as(superAdmin))
      .send({ enabled: true, delaysDays: [1, 3], subject: "Your Posygo account is almost ready", body: "You started signing up as {name}. Confirm your email to carry on.", ...body });

  beforeAll(async () => {
    await resetDatabase();
    await flushRateLimits();
    test = await startApp();
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    await test.http().post("/v1/auth/signup").send({ email: SELLER, password: "a long enough password", businessName: "Slow Goods", countryCodes: ["GB"], acceptTerms: true }).expect(202);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it("keeps the reminders page to super admins", async () => {
    await test.http().get("/v1/admin/reminders").set(as(finance)).expect(404);
    const list = (await test.http().get("/v1/admin/reminders").set(as(superAdmin)).expect(200)).body as ReminderView[];
    expect(list.find((reminder) => reminder.key === "SELLER_CONFIRM_EMAIL")).toMatchObject({ enabled: false, waiting: 1, delaysDays: [1, 3], customised: false });
  });

  it("sends nothing while a reminder is switched off", async () => {
    expect(await run(2)).toBe(0);
  });

  it("previews and sends a test with the name filled in", async () => {
    const template = { subject: "Hello {name}", body: "This is a reminder for {name} to finish signing up." };
    const preview = await test.http().post("/v1/admin/reminders/SELLER_CONFIRM_EMAIL/preview").set(as(superAdmin)).send(template).expect(200);
    expect(preview.body).toMatchObject({ subject: "Hello Ada's Atelier", actionLabel: "Confirm my email" });
    expect(preview.body.text).toContain("This is a reminder for Ada's Atelier");
    await test.http().post("/v1/admin/reminders/SELLER_CONFIRM_EMAIL/test").set(as(superAdmin)).send(template).expect(200, { to: "super@gfn.test" });
    expect(test.email.lastTo("super@gfn.test")!.subject).toBe("[Test] Hello Ada's Atelier");
  });

  it("refuses timings that go backwards", async () => {
    await enable("SELLER_CONFIRM_EMAIL", { delaysDays: [3, 1] }).expect(400);
  });

  it("sends each step once it's due, at most one every three days", async () => {
    await enable("SELLER_CONFIRM_EMAIL").expect(200);
    expect(await run(0)).toBe(0);
    expect(await run(1)).toBe(1);
    expect(reminders()[0]).toMatchObject({ subject: "Your Posygo account is almost ready", action: { label: "Confirm my email" } });
    expect(reminders()[0]!.text).toContain("You started signing up as Slow Goods");
    expect(await run(2)).toBe(0);
    expect(await run(4.5)).toBe(1);
    expect(await run(9)).toBe(0);
    expect(reminders()).toHaveLength(2);
  });

  it("stops for good when the person follows the stop link", async () => {
    const link = /\/reminders\/stop\?e=([A-Za-z0-9_-]+)&t=([0-9a-f]{64})/.exec(reminders()[0]!.text)!;
    await test.http().post("/v1/public/reminders/stop").send({ e: link[1], t: "0".repeat(64) }).expect(404);
    await test.http().post("/v1/public/reminders/stop").send({ e: link[1], t: link[2] }).expect(204);
    await query("DELETE FROM reminder_sends");
    expect(await run(2)).toBe(0);
    await query("DELETE FROM reminder_opt_outs");
  });

  it("counts a reminder as worked once the step is done", async () => {
    expect(await run(2)).toBe(1);
    await test.http().post("/v1/auth/resend-verification").send({ email: SELLER }).expect(202);
    const code = codeFrom(test.email.lastTo(SELLER)!.text);
    await test.http().post("/v1/auth/verify-email").send({ email: SELLER, code, password: "a long enough password" }).expect(200);
    await run(3);
    const list = (await test.http().get("/v1/admin/reminders").set(as(superAdmin)).expect(200)).body as ReminderView[];
    expect(list.find((reminder) => reminder.key === "SELLER_CONFIRM_EMAIL")).toMatchObject({ waiting: 0, last30Days: { sent: 1, completed: 1 } });
  });

  it("goes back to the standard wording on reset", async () => {
    await enable("SELLER_CONFIRM_EMAIL", { subject: "A custom subject line" }).expect(200);
    const reset = (await test.http().post("/v1/admin/reminders/SELLER_CONFIRM_EMAIL/reset").set(as(superAdmin)).expect(201)).body as ReminderView;
    expect(reset).toMatchObject({ customised: false, subject: "Your Posygo account is almost ready", enabled: true });
  });
});
