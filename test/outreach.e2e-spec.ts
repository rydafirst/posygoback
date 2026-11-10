import type { OutreachContactDetailView, OutreachContactView, OutreachSendResultView } from "../src/shared";
import { createStaff, flushRateLimits, resetDatabase, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

const PREP = { business: "North Prep", contactName: "Amaka", email: "hello@northprep.test", country: "Canada", city: "Toronto", kind: "PREP_CENTRE" };

describe("partner outreach", () => {
  let test: TestApp;
  let superAdmin: string;
  let finance: string;
  const contacts = () => test.http().get("/v1/admin/outreach/contacts").set(as(superAdmin)).expect(200);

  beforeAll(async () => {
    await resetDatabase();
    await flushRateLimits();
    test = await startApp();
    superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
  });

  afterAll(async () => {
    await test.app.close();
  });

  it("keeps outreach to super admins", async () => {
    await test.http().get("/v1/admin/outreach/contacts").set(as(finance)).expect(404);
    await test.http().post("/v1/admin/outreach/contacts").set(as(finance)).send(PREP).expect(404);
  });

  it("adds contacts, refuses a repeated email and imports a list without duplicates", async () => {
    await test.http().post("/v1/admin/outreach/contacts").set(as(superAdmin)).send(PREP).expect(201);
    const repeat = await test.http().post("/v1/admin/outreach/contacts").set(as(superAdmin)).send({ ...PREP, business: "Copy", email: "HELLO@northprep.test" }).expect(400);
    expect(repeat.body.fieldErrors.email[0]).toContain("North Prep");

    const imported = await test
      .http()
      .post("/v1/admin/outreach/contacts/import")
      .set(as(superAdmin))
      .send({
        contacts: [
          { business: "Lagos Link Cargo", email: "desk@lagoslink.test", country: "Canada", kind: "CARGO_AGENT", website: "" },
          { business: "No Email Prep", country: "Germany", city: "Berlin", kind: "PREP_CENTRE" },
          { business: "North Prep again", email: "hello@northprep.test", country: "Canada", kind: "PREP_CENTRE" },
        ],
      })
      .expect(201);
    expect(imported.body).toEqual({ added: 2, duplicates: ["North Prep again"] });
    const list = (await contacts()).body as OutreachContactView[];
    expect(list.map((contact) => contact.business).sort()).toEqual(["Lagos Link Cargo", "No Email Prep", "North Prep"]);
    expect(list.every((contact) => contact.status === "NOT_CONTACTED")).toBe(true);
  });

  it("sends each contact their own filled-in email, skips anyone without an email, and logs it", async () => {
    const list = (await contacts()).body as OutreachContactView[];
    const result = (
      await test
        .http()
        .post("/v1/admin/outreach/send")
        .set(as(superAdmin))
        .send({ contactIds: list.map((contact) => contact.id), subject: "More clients for {business}", body: "Hi {name}, we need a partner in {city}, {country}. Would {business} be interested?" })
        .expect(200)
    ).body as OutreachSendResultView;
    expect(result).toMatchObject({ sent: 2, failed: 0, sentToday: 2 });
    expect(result.skipped).toEqual([expect.objectContaining({ business: "No Email Prep", reason: "No email address" })]);

    const prep = test.email.lastTo("hello@northprep.test")!;
    expect(prep).toMatchObject({ subject: "More clients for North Prep", kind: "outreach" });
    expect(prep.text).toContain("Hi Amaka, we need a partner in Toronto, Canada. Would North Prep be interested?");
    expect(prep.optOut?.url).toMatch(/\/outreach\/stop\?c=[0-9a-f-]{36}&t=[0-9a-f]{64}$/);
    expect(test.email.lastTo("desk@lagoslink.test")!.text).toContain("Hi there, we need a partner in Canada, Canada.");

    const id = list.find((contact) => contact.business === "North Prep")!.id;
    const detail = (await test.http().get(`/v1/admin/outreach/contacts/${id}`).set(as(superAdmin)).expect(200)).body as OutreachContactDetailView;
    expect(detail).toMatchObject({ status: "MESSAGED", messageCount: 1 });
    expect(detail.messages[0]).toMatchObject({ subject: "More clients for North Prep", status: "SENT", sentByEmail: "super@gfn.test" });
  });

  it("lets the contact opt out, then never emails them again", async () => {
    const list = (await contacts()).body as OutreachContactView[];
    const prep = list.find((contact) => contact.business === "North Prep")!;
    const url = new URL(test.email.lastTo("hello@northprep.test")!.optOut!.url);
    await test.http().post("/v1/public/outreach/stop").send({ c: prep.id, t: "0".repeat(64) }).expect(404);
    await test.http().post("/v1/public/outreach/stop").send({ c: url.searchParams.get("c"), t: url.searchParams.get("t") }).expect(204);

    const result = (await test.http().post("/v1/admin/outreach/send").set(as(superAdmin)).send({ contactIds: [prep.id], subject: "Following up", body: "Just following up on my last email to you." }).expect(200)).body as OutreachSendResultView;
    expect(result).toMatchObject({ sent: 0, skipped: [expect.objectContaining({ reason: "Asked not to be emailed" })] });
    await test.http().patch(`/v1/admin/outreach/contacts/${prep.id}`).set(as(superAdmin)).send({ status: "MESSAGED" }).expect(409);
  });

  it("tracks replies and removes a contact", async () => {
    const list = (await contacts()).body as OutreachContactView[];
    const cargo = list.find((contact) => contact.business === "Lagos Link Cargo")!;
    const updated = await test.http().patch(`/v1/admin/outreach/contacts/${cargo.id}`).set(as(superAdmin)).send({ status: "CALL_BOOKED", notes: "Call on Friday" }).expect(200);
    expect(updated.body).toMatchObject({ status: "CALL_BOOKED", notes: "Call on Friday" });
    const filtered = (await test.http().get("/v1/admin/outreach/contacts?status=CALL_BOOKED").set(as(superAdmin)).expect(200)).body as OutreachContactView[];
    expect(filtered.map((contact) => contact.business)).toEqual(["Lagos Link Cargo"]);
    await test.http().delete(`/v1/admin/outreach/contacts/${cargo.id}`).set(as(superAdmin)).expect(204);
    await test.http().get(`/v1/admin/outreach/contacts/${cargo.id}`).set(as(superAdmin)).expect(404);
  });
});
