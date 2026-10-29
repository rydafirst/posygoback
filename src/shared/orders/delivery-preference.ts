export const DELIVERY_PREFERENCES = ["CHEAPEST", "FASTEST"] as const;
export type DeliveryPreference = (typeof DELIVERY_PREFERENCES)[number];

export type RateTag = DeliveryPreference;

export const DELIVERY_PREFERENCE_LABELS: Record<DeliveryPreference, { label: string; hint: string }> = {
  CHEAPEST: { label: "Cheapest", hint: "The lowest price, even if it takes longer" },
  FASTEST: { label: "Fastest", hint: "The quickest delivery, even if it costs more" },
};

interface RatedOption {
  id: string;
  chargeMinor: number;
  estimatedDays: number | null;
  carrier?: string;
  service?: string;
}

const NEXT_DAY = /next[\s-]?day|24\s?h/i;

export function serviceKey(carrier: string, service: string): string {
  return `${carrier} · ${service}`.slice(0, 200);
}

export function deliveryTimeLabel(estimatedDays: number | null, service: string): string | null {
  if (estimatedDays) {
    return estimatedDays === 1 ? "Next day" : `About ${estimatedDays} days`;
  }
  return NEXT_DAY.test(service) ? "Next day" : null;
}

export interface RateRanking {
  tags: ReadonlyMap<string, RateTag[]>;
  preferredId: string | null;
  order: string[];
}

function daysOf(rate: RatedOption): number | null {
  return rate.estimatedDays ?? (rate.service && NEXT_DAY.test(rate.service) ? 1 : null);
}

function cheapestFirst(a: RatedOption, b: RatedOption): number {
  return a.chargeMinor - b.chargeMinor || (daysOf(a) ?? Infinity) - (daysOf(b) ?? Infinity);
}

function fastestFirst(a: RatedOption, b: RatedOption): number {
  return (daysOf(a) ?? Infinity) - (daysOf(b) ?? Infinity) || a.chargeMinor - b.chargeMinor;
}

export function rankRates(rates: readonly RatedOption[], preference: DeliveryPreference, preferredService: string | null = null): RateRanking {
  const byPrice = [...rates].sort(cheapestFirst);
  const byDays = [...rates].filter((rate) => daysOf(rate) !== null).sort(fastestFirst);
  const cheapest = byPrice[0];
  const fastest = byDays[0];
  const tags = new Map<string, RateTag[]>(rates.map((rate) => [rate.id, []]));
  if (cheapest) {
    tags.get(cheapest.id)!.push("CHEAPEST");
  }
  if (fastest) {
    tags.get(fastest.id)!.push("FASTEST");
  }
  const chosen = preferredService ? rates.find((rate) => rate.carrier !== undefined && rate.service !== undefined && serviceKey(rate.carrier, rate.service) === preferredService) : undefined;
  const preferred = chosen ?? (preference === "FASTEST" ? (fastest ?? cheapest) : cheapest);
  const rest = (preference === "FASTEST" ? [...byDays, ...byPrice.filter((rate) => daysOf(rate) === null)] : byPrice).filter((rate) => rate.id !== preferred?.id);
  return { tags, preferredId: preferred?.id ?? null, order: [...(preferred ? [preferred.id] : []), ...rest.map((rate) => rate.id)] };
}
