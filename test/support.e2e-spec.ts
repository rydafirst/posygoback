import { randomUUID } from "node:crypto";

import type { SupportCaseDetailView, SupportCaseView, SupportReportInput } from "../src/shared";
import { createStaff, flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

const now = () => new Date().toISOString();

function errorReport(overrides: Partial<SupportReportInput> = {}): SupportReportInput {
  return {
    kind: "ERROR",
    page: `/inbound/${randomUUID()}`,
    message: "",
    error: { code: "internal_error", status: 500, endpoint: `/v1/inbound/${randomUUID()}/submit`, correlationId: randomUUID() },
    trail: [
      { at: now(), what: "Opened Declare a shipment" },
      { at: now(), what: "Changed Units per box" },
    ],
    ...overrides,
  };
}

describe("support cases from the in-app helper", () => {
  let test: TestApp;
  let vendor: string;
  let admin: string;
  let finance: string;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    vendor = (await signUpAndVerify(test, "owner@helped.test")).accessToken;
    admin = await createStaff(test, "admin@gfn.test", "ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("opens a case for a system failure, tells support, and strips card-like numbers", async () => {
    const result = await test
      .http()
      .post("/v1/support-cases")
      .set(as(vendor))
      .send(errorReport({ message: "It failed after I typed 4111 1111 1111 1111 by mistake" }))
      .expect(201);
    expect(result.body).toEqual({ reference: expect.stringMatching(/^CASE-[A-Z0-9]{8}$/), alreadyKnown: false });
    expect(test.email.lastTo("help@gfn.test")?.subject).toContain(result.body.reference);
    const [report] = await query<{ message: string }>("SELECT message FROM support_reports");
    expect(report!.message).toBe("It failed after I typed [number removed] by mistake");
  });

  it("groups the same failure from different people into one case, without emailing support again", async () => {
    const sentBefore = test.email.sent.length;
    const first = await test
      .http()
      .post("/v1/public/support-cases")
      .send(errorReport({ contactEmail: "visitor@example.test" }))
      .expect(201);
    expect(first.body.alreadyKnown).toBe(true);
    const [row] = await query<{ report_count: number }>("SELECT report_count FROM support_cases");
    expect(row!.report_count).toBe(2);
    expect(test.email.sent.length).toBe(sentBefore);
  });

  it("refuses reports that aren't shaped like one", async () => {
    await test.http().post("/v1/public/support-cases").send({ kind: "ERROR", page: "/orders", trail: [] }).expect(400);
    await test.http().post("/v1/public/support-cases").send({ kind: "QUESTION", page: "/orders", message: "hi" }).expect(400);
    await test.http().post("/v1/public/support-cases").send({ kind: "QUESTION", page: "https://evil.example/x", message: "Where is my order?" }).expect(400);
    await test
      .http()
      .post("/v1/public/support-cases")
      .send(errorReport({ trail: Array.from({ length: 21 }, () => ({ at: now(), what: "Clicked" })) }))
      .expect(400);
  });

  it("lets support staff see the steps and resolve the case, and tells the person who reported it", async () => {
    await test.http().get("/v1/admin/support-cases").set(as(finance)).expect(404);
    await test.http().get("/v1/admin/support-cases").set(as(vendor)).expect(404);
    const cases = (await test.http().get("/v1/admin/support-cases?status=OPEN").set(as(admin)).expect(200)).body as SupportCaseView[];
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ kind: "ERROR", errorCode: "internal_error", reports: 2 });
    const detail = (await test.http().get(`/v1/admin/support-cases/${cases[0]!.id}`).set(as(admin)).expect(200)).body as SupportCaseDetailView;
    expect(detail.reportDetails.map((report) => report.reporter.email).sort()).toEqual(["owner@helped.test", "visitor@example.test"]);
    expect(detail.reportDetails[1]!.trail.map((step) => step.what)).toEqual(["Opened Declare a shipment", "Changed Units per box"]);
    const resolved = (await test.http().post(`/v1/admin/support-cases/${cases[0]!.id}/resolve`).set(as(admin)).send({ note: "We fixed the shipment form; please try again." }).expect(200))
      .body as SupportCaseDetailView;
    expect(resolved).toMatchObject({ status: "RESOLVED", resolutionNote: "We fixed the shipment form; please try again." });
    await test.http().post(`/v1/admin/support-cases/${cases[0]!.id}/resolve`).set(as(admin)).send({ note: "Again please" }).expect(409);
    const feed = (await test.http().get("/v1/notifications").set(as(vendor)).expect(200)).body as { items: Array<{ title: string; body: string }> };
    expect(feed.items[0]).toMatchObject({ title: "The problem you reported is sorted", body: expect.stringContaining(resolved.reference) });
  });

  it("starts a new case when the same failure comes back after it was resolved", async () => {
    const again = await test.http().post("/v1/support-cases").set(as(vendor)).send(errorReport()).expect(201);
    expect(again.body.alreadyKnown).toBe(false);
  });

  it("takes questions as their own cases", async () => {
    const question = await test.http().post("/v1/support-cases").set(as(vendor)).send({ kind: "QUESTION", page: "/wallet", message: "Why was I charged twice for storage?" }).expect(201);
    const second = await test.http().post("/v1/support-cases").set(as(vendor)).send({ kind: "QUESTION", page: "/wallet", message: "Why was I charged twice for storage?" }).expect(201);
    expect(second.body.reference).not.toBe(question.body.reference);
  });

  it("limits how often one address can report", async () => {
    let status = 201;
    for (let attempt = 0; attempt < 25 && status === 201; attempt += 1) {
      status = (await test.http().post("/v1/public/support-cases").set("x-test-client-ip", "203.0.113.9").send({ kind: "QUESTION", page: "/", message: "Is anyone there?" })).status;
    }
    expect(status).toBe(429);
  });
});
