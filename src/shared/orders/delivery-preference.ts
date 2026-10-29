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
}

export interface RateRanking {
  tags: ReadonlyMap<string, RateTag[]>;
  preferredId: string | null;
  order: string[];
}

function cheapestFirst(a: RatedOption, b: RatedOption): number {
  return a.chargeMinor - b.chargeMinor || (a.estimatedDays ?? Infinity) - (b.estimatedDays ?? Infinity);
}

function fastestFirst(a: RatedOption, b: RatedOption): number {
  return (a.estimatedDays ?? Infinity) - (b.estimatedDays ?? Infinity) || a.chargeMinor - b.chargeMinor;
}

export function rankRates(rates: readonly RatedOption[], preference: DeliveryPreference): RateRanking {
  const byPrice = [...rates].sort(cheapestFirst);
  const byDays = [...rates].filter((rate) => rate.estimatedDays !== null).sort(fastestFirst);
  const cheapest = byPrice[0];
  const fastest = byDays[0];
  const tags = new Map<string, RateTag[]>(rates.map((rate) => [rate.id, []]));
  if (cheapest) {
    tags.get(cheapest.id)!.push("CHEAPEST");
  }
  if (fastest) {
    tags.get(fastest.id)!.push("FASTEST");
  }
  const preferred = preference === "FASTEST" ? (fastest ?? cheapest) : cheapest;
  const rest = (preference === "FASTEST" ? [...byDays, ...byPrice.filter((rate) => rate.estimatedDays === null)] : byPrice).filter((rate) => rate.id !== preferred?.id);
  return { tags, preferredId: preferred?.id ?? null, order: [...(preferred ? [preferred.id] : []), ...rest.map((rate) => rate.id)] };
}
