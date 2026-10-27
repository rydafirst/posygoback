import type { NotificationFeedView } from "../src/shared";

import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, PartnerFlow } from "./partner-helpers";

const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("in-app notifications for staff and people", () => {
  let test: TestApp;
  let superAdmin: string;
  let compliance: string;
  let finance: string;
  let gbOps: string;
  let usOps: string;

  const feed = async (token: string) => (await test.http().get("/v1/notifications").set(as(token)).expect(200)).body as NotificationFeedView;
  const titles = async (token: string) => (await feed(token)).items.map((item) => item.title);

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
    gbOps = await createStaff(test, "ops-gb@gfn.test", "COUNTRY_OPS", "GB");
    usOps = await createStaff(test, "ops-us@gfn.test", "COUNTRY_OPS", "US");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("tells the people who review partners when someone applies, and again when they're ready for review", async () => {
    const partners = new PartnerFlow(test);
    const { token } = await partners.apply("bisi@partner.test", "Bisi Applicant");

    const applied = (await feed(superAdmin)).items.find((item) => item.title === "New partner application from Bisi Applicant");
    expect(applied).toMatchObject({ href: "/admin/partners", read: false });
    expect(applied!.body).toMatch(/^FP-GB-\w+ in GB\./);
    expect(await titles(compliance)).toContain("New partner application from Bisi Applicant");
    expect(await titles(finance)).not.toContain("New partner application from Bisi Applicant");
    expect(await titles(gbOps)).not.toContain("New partner application from Bisi Applicant");

    await partners.completeSteps(token, "Bisi Applicant");
    expect((await titles(superAdmin))[0]).toBe("Bisi Applicant is ready for review");
    expect(await titles(compliance)).toContain("Bisi Applicant is ready for review");
    expect((await feed(token)).items[0]!.title).toBe("We've got your partner application");
  });

  it("tells staff when a vendor joins, and welcomes the vendor in their own list", async () => {
    const vendor = (await signUpAndVerify(test, "owner@acme.test")).accessToken;
    expect(await titles(compliance)).toContain("Acme Goods joined");
    expect(await titles(usOps)).not.toContain("Acme Goods joined");
    expect((await feed(vendor)).items[0]).toMatchObject({ title: "Welcome to Posygo, Acme Goods", href: "/overview" });
  });

  it("puts security emails in the person's own list, linked to their security page", async () => {
    await test.http().post("/v1/auth/login").set("User-Agent", SAFARI_IPHONE).send({ email: "owner@acme.test", password: "a long enough password" }).expect(200);
    const vendor = (await test.http().post("/v1/auth/login").set("User-Agent", SAFARI_IPHONE).send({ email: "owner@acme.test", password: "a long enough password" }).expect(200)).body
      .accessToken as string;
    const alert = (await feed(vendor)).items.find((item) => item.title === "New sign-in to your Posygo account");
    expect(alert).toMatchObject({ href: "/settings/security" });
    expect(alert!.body).not.toMatch(/https?:\/\//);
    expect((await feed(superAdmin)).items.map((item) => item.title)).not.toContain(alert!.title);
  });

  it("tells support staff in the reporter's country about a new case, but not the reporter", async () => {
    const vendor = (await test.http().post("/v1/auth/login").send({ email: "owner@acme.test", password: "a long enough password" }).expect(200)).body.accessToken as string;
    const created = await test.http().post("/v1/support-cases").set(as(vendor)).send({ kind: "QUESTION", page: "/wallet", message: "Why was I charged twice for storage?" }).expect(201);
    const title = `${created.body.reference as string}: someone needs help`;
    expect((await feed(gbOps)).items.find((item) => item.title === title)).toMatchObject({ href: "/admin/support", body: "On /wallet. Why was I charged twice for storage?" });
    expect(await titles(superAdmin)).toContain(title);
    expect(await titles(usOps)).not.toContain(title);
    expect(await titles(vendor)).not.toContain(title);
  });
});
