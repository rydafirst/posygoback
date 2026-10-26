import type { TaxRules } from "../country/country.schema";
import { discountFor, priceOrder, taxFor } from "./pricing";

const VAT: TaxRules = { model: "VAT", standardRateBps: 2000, pricesIncludeTax: true };
const SALES_TAX: TaxRules = { model: "SALES_TAX", standardRateBps: 0, pricesIncludeTax: false, regionalRatesBps: { NJ: 663, NY: 400 } };

describe("tax", () => {
  it("reads VAT out of inclusive prices without adding it", () => {
    expect(taxFor(VAT, 12_000)).toEqual({ taxMinor: 2000, included: true, rateBps: 2000 });
  });

  it("adds sales tax by region and charges nothing where there's no rate", () => {
    expect(taxFor(SALES_TAX, 10_000, "nj")).toEqual({ taxMinor: 663, included: false, rateBps: 663 });
    expect(taxFor(SALES_TAX, 10_000, "OR").taxMinor).toBe(0);
    expect(taxFor({ ...SALES_TAX, model: "NONE", standardRateBps: 500 }, 10_000).taxMinor).toBe(0);
  });
});

describe("pricing an order", () => {
  const lines = [
    { unitPriceMinor: 4_500, quantity: 2 },
    { unitPriceMinor: 1_000, quantity: 1 },
  ];

  it("gives the vendor the discounted goods and us the delivery, with VAT inside the price", () => {
    expect(priceOrder({ lines, discountMinor: 1_000, deliveryMinor: 499, tax: VAT, commissionBps: 0 })).toEqual({
      goodsMinor: 10_000,
      discountMinor: 1_000,
      deliveryMinor: 499,
      taxMinor: 1500,
      taxIncluded: true,
      totalMinor: 9_499,
      vendorShareMinor: 9_000,
      platformShareMinor: 499,
    });
  });

  it("keeps added sales tax and commission on our side", () => {
    const price = priceOrder({ lines, discountMinor: 0, deliveryMinor: 800, tax: SALES_TAX, region: "NY", commissionBps: 500 });
    expect(price).toMatchObject({ taxMinor: 400, totalMinor: 11_200, vendorShareMinor: 9_500, platformShareMinor: 1_700 });
    expect(price.vendorShareMinor + price.platformShareMinor).toBe(price.totalMinor);
  });

  it("never discounts below zero", () => {
    expect(priceOrder({ lines, discountMinor: 50_000, deliveryMinor: 0, tax: VAT, commissionBps: 0 }).discountMinor).toBe(10_000);
    expect(discountFor({ kind: "PERCENT", percentBps: 1500, amountMinor: null }, 9_999)).toBe(1_499);
    expect(discountFor({ kind: "FIXED", percentBps: null, amountMinor: 2_000 }, 1_500)).toBe(1_500);
  });
});
