import { COMPANY, EARNINGS_SCHEDULE_URL } from "../src/common/brand/brand";
import { PARTNER_AGREEMENT_VERSION, STANDARD_AGREEMENT_VERSION } from "../src/database/agreements/standard-agreements";
import { flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp } from "./harness";

describe("standard agreements on start-up", () => {
  let test: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    await flushRateLimits();
    await insertLegalDocument("GB", "TERMS", "2026.01");
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "2026.11");
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

  it("asks partners for no deposit or insurance and points them to the earnings schedule", async () => {
    const agreement = (await test.http().get("/v1/legal/GB/PARTNER_AGREEMENT").expect(200)).body as { version: string; body: string };
    expect(agreement.version).toBe(PARTNER_AGREEMENT_VERSION);
    expect(agreement.body).toContain(EARNINGS_SCHEDULE_URL);
    expect(agreement.body).toContain("We do not ask you for a security deposit, and we do not require you to hold insurance for the Goods.");
    expect(agreement.body).not.toMatch(/Security Deposit|pay any .*deposit/);
  });

  it("leaves documents a market has never used alone", async () => {
    await test.http().get("/v1/legal/GB/PRIVACY").expect(404);
  });
});
