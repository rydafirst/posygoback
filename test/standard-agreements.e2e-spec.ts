import { COMPANY } from "../src/common/brand/brand";
import { STANDARD_AGREEMENT_VERSION } from "../src/database/agreements/standard-agreements";
import { flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp } from "./harness";

describe("standard agreements on start-up", () => {
  let test: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    await flushRateLimits();
    await insertLegalDocument("GB", "TERMS", "2026.01");
    test = await startApp();
  });

  afterAll(async () => {
    await test.app.close();
  });

  it("publishes the current version of a document a market already uses", async () => {
    const terms = (await test.http().get("/v1/legal/GB/TERMS").expect(200)).body as { version: string; body: string };
    expect(terms.version).toBe(STANDARD_AGREEMENT_VERSION);
    expect(terms.body).toContain(`${COMPANY.legalName}, a company registered in ${COMPANY.jurisdiction} with company number ${COMPANY.number}`);
  });

  it("leaves documents a market has never used alone", async () => {
    await test.http().get("/v1/legal/GB/PRIVACY").expect(404);
  });
});
