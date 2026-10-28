import type { DraftResult } from "../src/shared";
import { DRAFT_LIMIT_PER_USER } from "../src/shared";
import { flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as } from "./partner-helpers";

describe("form drafts", () => {
  let test: TestApp;
  let owner: string;
  let other: string;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    owner = (await signUpAndVerify(test, "owner@drafts.test")).accessToken;
    other = (await signUpAndVerify(test, "other@drafts.test")).accessToken;
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("saves, returns, updates and discards a draft for its owner only", async () => {
    const empty = await test.http().get("/v1/drafts/product:new").set(as(owner)).expect(200);
    expect((empty.body as DraftResult).draft).toBeNull();

    await test
      .http()
      .put("/v1/drafts/product:new")
      .set(as(owner))
      .send({ data: { name: "Linen shirt" } })
      .expect(200);
    await test
      .http()
      .put("/v1/drafts/product:new")
      .set(as(owner))
      .send({ data: { name: "Linen shirt", sku: "LS-1" } })
      .expect(200);

    const saved = await test.http().get("/v1/drafts/product:new").set(as(owner)).expect(200);
    expect((saved.body as DraftResult).draft).toEqual({ key: "product:new", data: { name: "Linen shirt", sku: "LS-1" }, updatedAt: expect.any(String) });

    const stranger = await test.http().get("/v1/drafts/product:new").set(as(other)).expect(200);
    expect((stranger.body as DraftResult).draft).toBeNull();

    await test.http().delete("/v1/drafts/product:new").set(as(owner)).expect(204);
    const gone = await test.http().get("/v1/drafts/product:new").set(as(owner)).expect(200);
    expect((gone.body as DraftResult).draft).toBeNull();
  });

  it("rejects odd keys, oversized drafts and signed-out requests", async () => {
    await test.http().put("/v1/drafts/Product New").set(as(owner)).send({ data: {} }).expect(400);
    await test
      .http()
      .put("/v1/drafts/order:new")
      .set(as(owner))
      .send({ data: { notes: "x".repeat(70_000) } })
      .expect(400);
    await test.http().put("/v1/drafts/order:new").set(as(owner)).send({ data: "text" }).expect(400);
    await test.http().get("/v1/drafts/order:new").expect(401);
  });

  it("caps how many drafts one person keeps", async () => {
    for (let index = 0; index < DRAFT_LIMIT_PER_USER; index += 1) {
      await test.http().put(`/v1/drafts/bulk:${index}`).set(as(other)).send({ data: { index } }).expect(200);
    }
    await test
      .http()
      .put("/v1/drafts/bulk:0")
      .set(as(other))
      .send({ data: { index: 0, again: true } })
      .expect(200);
    await test.http().put("/v1/drafts/bulk:extra").set(as(other)).send({ data: {} }).expect(409);
  });
});
