import type { PublicPriceListView } from "../src/shared";
import { flushRateLimits, resetDatabase, startApp, type TestApp } from "./harness";
import { query } from "./partner-helpers";

describe("public prices", () => {
  let test: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("publishes each live market's prices without sign-in, and nothing internal", async () => {
    const prices = (await test.http().get("/v1/public/prices/GB").expect(200)).body as PublicPriceListView & Record<string, unknown>;
    expect(prices).toMatchObject({ countryCode: "GB", countryName: "United Kingdom", currency: "GBP", shopping: { commissionBps: 1500 } });
    expect(prices.schedule.fulfilment.baseMinor).toBeGreaterThan(0);
    expect(Object.keys(prices.schedule)).not.toEqual(expect.arrayContaining(["partner"]));
    expect(Object.keys(prices.schedule)).not.toEqual(expect.arrayContaining(["adjustments"]));
    await test.http().get("/v1/public/prices/ZZ").expect(404);
    await test.http().get("/v1/public/prices/gb").expect(400);
  });

  it("hides a market that isn't live", async () => {
    await query("UPDATE countries SET status = 'SUSPENDED' WHERE code = 'US'");
    await test.http().get("/v1/public/prices/US").expect(404);
  });
});
