import type { TaxRules } from "../country/country.schema";
import type { DiscountKind } from "./discount.schema";

const BPS = 10_000;

export interface TaxQuote {
  taxMinor: number;
  included: boolean;
  rateBps: number;
}

export function taxFor(rules: TaxRules, taxableMinor: number, region?: string | null): TaxQuote {
  const regional = region ? rules.regionalRatesBps?.[region.trim().toUpperCase()] : undefined;
  const rateBps = rules.model === "NONE" ? 0 : (regional ?? rules.standardRateBps);
  if (rateBps <= 0 || taxableMinor <= 0) {
    return { taxMinor: 0, included: rules.pricesIncludeTax, rateBps };
  }
  if (rules.pricesIncludeTax) {
    return { taxMinor: Math.round((taxableMinor * rateBps) / (BPS + rateBps)), included: true, rateBps };
  }
  return { taxMinor: Math.round((taxableMinor * rateBps) / BPS), included: false, rateBps };
}

export interface PriceInput {
  lines: ReadonlyArray<{ unitPriceMinor: number; quantity: number }>;
  discountMinor: number;
  deliveryMinor: number;
  tax: TaxRules;
  region?: string | null;
  commissionBps: number;
}

export interface PriceBreakdown {
  goodsMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  taxIncluded: boolean;
  totalMinor: number;
  vendorShareMinor: number;
  platformShareMinor: number;
}

export function goodsTotal(lines: PriceInput["lines"]): number {
  return lines.reduce((total, line) => total + line.unitPriceMinor * line.quantity, 0);
}

export function priceOrder(input: PriceInput): PriceBreakdown {
  const goodsMinor = goodsTotal(input.lines);
  const discountMinor = Math.min(Math.max(0, input.discountMinor), goodsMinor);
  const discounted = goodsMinor - discountMinor;
  const tax = taxFor(input.tax, discounted, input.region);
  const addedTax = tax.included ? 0 : tax.taxMinor;
  const totalMinor = discounted + input.deliveryMinor + addedTax;
  const commission = Math.round((discounted * input.commissionBps) / BPS);
  const vendorShareMinor = discounted - commission;
  return {
    goodsMinor,
    discountMinor,
    deliveryMinor: input.deliveryMinor,
    taxMinor: tax.taxMinor,
    taxIncluded: tax.included,
    totalMinor,
    vendorShareMinor,
    platformShareMinor: totalMinor - vendorShareMinor,
  };
}

export interface DiscountRule {
  kind: DiscountKind;
  percentBps: number | null;
  amountMinor: number | null;
}

export function discountFor(rule: DiscountRule, goodsMinor: number): number {
  const raw = rule.kind === "PERCENT" ? Math.floor((goodsMinor * (rule.percentBps ?? 0)) / BPS) : (rule.amountMinor ?? 0);
  return Math.min(raw, goodsMinor);
}
