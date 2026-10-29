import type { AssistantQuestionView, AssistantUsageView, KnowledgePack } from "../src/shared";
import type { AnswerModel, AnswerRequest, ModelAnswer } from "../src/modules/assistant/answer-model.port";
import { ANSWER_MODEL } from "../src/modules/assistant/answer-model.port";
import { KNOWLEDGE_FETCH } from "../src/modules/assistant/knowledge-pack.service";
import { createStaff, flushRateLimits, fundWallet, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

class ScriptedModel implements AnswerModel {
  readonly enabled = true;
  readonly requests: AnswerRequest[] = [];
  reply: string | Error = "Packing an order costs £2.50.";

  answer(request: AnswerRequest): Promise<ModelAnswer> {
    this.requests.push(request);
    return this.reply instanceof Error ? Promise.reject(this.reply) : Promise.resolve({ text: this.reply, inputTokens: 1200, outputTokens: 40 });
  }
}

const PACK: KnowledgePack = {
  builtAt: "2026-10-27T00:00:00.000Z",
  pages: [
    {
      route: "/wallet",
      title: "Wallet",
      purpose: "Your prepaid balance.",
      steps: ["Add funds.", "Watch charges."],
      fields: [{ name: "amountMinor", labels: ["Amount to add"], meaning: "How much to add." }],
      related: [],
    },
  ],
  articles: [{ title: "Fulfilment costs explained", path: "/guides/fulfilment-costs-explained", text: "Storage is charged per box." }],
  faqs: [],
};

describe("answers from the helper", () => {
  let test: TestApp;
  let vendor: string;
  let vendorId: string;
  let admin: string;
  const model = new ScriptedModel();

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp(undefined, [
      [ANSWER_MODEL, model],
      [KNOWLEDGE_FETCH, () => Promise.resolve(PACK)],
    ]);
    vendor = (await signUpAndVerify(test, "owner@answers.test")).accessToken;
    vendorId = (await query<{ vendor_id: string }>("SELECT vendor_id FROM users WHERE email = 'owner@answers.test'"))[0]!.vendor_id;
    await fundWallet(vendorId, 4_200);
    admin = await createStaff(test, "admin@gfn.test", "ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("says when answers are switched on", async () => {
    expect((await test.http().get("/v1/public/assistant/status").expect(200)).body).toEqual({ answers: true });
  });

  it("answers from the page, the prices and the seller's own account, and nothing else", async () => {
    const reply = await test
      .http()
      .post("/v1/assistant/answers")
      .set(as(vendor))
      .send({ page: "/wallet", question: "How much is packing? My card is 4111 1111 1111 1111", history: [{ from: "helper", text: "Hi, I'm Posy." }] })
      .expect(200);
    expect(reply.body).toEqual({ answer: "Packing an order costs £2.50.", handoff: false });
    const request = model.requests.at(-1)!;
    expect(request.system).toContain("Page: Wallet (/wallet)");
    expect(request.system).toContain("- £42.00 (status ACTIVE");
    expect(request.system).toContain("Call them by their business name, Acme Goods.");
    expect(request.system).toContain("Prices in United Kingdom (GBP)");
    expect(request.system).not.toContain("Prices in United States");
    expect(request.turns).toEqual([{ role: "user", content: "How much is packing? My card is [number removed]" }]);
    const [logged] = await query<{ question: string; outcome: string; input_tokens: number }>("SELECT question, outcome::text, input_tokens FROM assistant_questions");
    expect(logged).toEqual({ question: "How much is packing? My card is [number removed]", outcome: "ANSWERED", input_tokens: 1200 });
  });

  it("gives visitors general answers without any account details", async () => {
    await test.http().post("/v1/public/assistant/answers").send({ page: "/signup", question: "What does storage cost?" }).expect(200);
    const request = model.requests.at(-1)!;
    expect(request.system).toContain("a visitor who isn't signed in");
    expect(request.system).toContain("Prices in United States");
  });

  it("hands over to the team when it isn't sure or the service fails, and logs the gap", async () => {
    model.reply = "UNSURE";
    expect((await test.http().post("/v1/public/assistant/answers").send({ page: "/", question: "Do you ship to Mars?" }).expect(200)).body).toEqual({ answer: null, handoff: true });
    model.reply = new Error("timeout");
    expect((await test.http().post("/v1/public/assistant/answers").send({ page: "/", question: "Is anyone there?" }).expect(200)).body).toEqual({ answer: null, handoff: true });
    model.reply = "Packing an order costs £2.50.";
    await test.http().get("/v1/admin/assistant/gaps").set(as(vendor)).expect(404);
    const gaps = (await test.http().get("/v1/admin/assistant/gaps").set(as(admin)).expect(200)).body as AssistantQuestionView[];
    expect(gaps.map((gap) => [gap.question, gap.outcome])).toEqual([
      ["Is anyone there?", "FAILED"],
      ["Do you ship to Mars?", "UNSURE"],
    ]);
    const usage = (await test.http().get("/v1/admin/assistant/usage?days=1").set(as(admin)).expect(200)).body as AssistantUsageView;
    expect(usage).toMatchObject({ questions: 4, answered: 2, unsure: 1, inputTokens: 3600, outputTokens: 120 });
  });

  it("knows a team member's role and what is waiting for them", async () => {
    const compliance = await createStaff(test, "compliance@gfn.test", "COMPLIANCE");
    await test.http().post("/v1/assistant/answers").set(as(compliance)).send({ page: "/admin", question: "What should I do first today?" }).expect(200);
    const request = model.requests.at(-1)!;
    expect(request.system).toContain("working as compliance (compliance@gfn.test), covering every country");
    expect(request.system).not.toContain("You have no account details");
  });

  it("sees what's on the person's screen, without card numbers", async () => {
    await test
      .http()
      .post("/v1/assistant/answers")
      .set(as(vendor))
      .send({
        page: "/wallet",
        question: "Is this right?",
        screen: { title: "Wallet", focused: "Amount to add", fields: [{ label: "Amount to add", value: "50" }, { label: "Note", value: "card 4111 1111 1111 1111" }], alerts: ["Enter at least £10."] },
      })
      .expect(200);
    const request = model.requests.at(-1)!;
    expect(request.system).toContain("They are on the field: Amount to add");
    expect(request.system).toContain('- Amount to add: "50"');
    expect(request.system).toContain('- Note: "card [number removed]"');
    expect(request.system).toContain("- Enter at least £10.");
    await test
      .http()
      .post("/v1/assistant/answers")
      .set(as(vendor))
      .send({ page: "/wallet", question: "Is this right?", screen: { fields: Array.from({ length: 31 }, (_, index) => ({ label: `Field ${index}`, value: "x" })) } })
      .expect(400);
  });

  it("refuses badly shaped questions and stops at the daily budget", async () => {
    await test.http().post("/v1/public/assistant/answers").send({ page: "https://evil.example", question: "hi there" }).expect(400);
    await test
      .http()
      .post("/v1/public/assistant/answers")
      .send({ page: "/", question: "x".repeat(501) })
      .expect(400);
    await query("INSERT INTO assistant_questions (page, question, outcome) SELECT '/', 'filler', 'ANSWERED' FROM generate_series(1, 2000)");
    const before = model.requests.length;
    expect((await test.http().post("/v1/public/assistant/answers").send({ page: "/", question: "One more?" }).expect(200)).body).toEqual({ answer: null, handoff: true });
    expect(model.requests.length).toBe(before);
  });

  it("limits how often one address can ask", async () => {
    await query("DELETE FROM assistant_questions");
    let status = 200;
    for (let attempt = 0; attempt < 35 && status === 200; attempt += 1) {
      status = (await test.http().post("/v1/public/assistant/answers").set("x-test-client-ip", "203.0.113.20").send({ page: "/", question: "Hello?" })).status;
    }
    expect(status).toBe(429);
  });
});
