import { rankRates } from "./delivery-preference";

const RATES = [
  { id: "economy", chargeMinor: 399, estimatedDays: 4 },
  { id: "express", chargeMinor: 899, estimatedDays: 1 },
  { id: "standard", chargeMinor: 549, estimatedDays: 2 },
  { id: "mystery", chargeMinor: 450, estimatedDays: null },
];

describe("ranking shipping rates", () => {
  it("tags the cheapest and fastest, and puts the cheapest first for a seller who wants it", () => {
    const ranking = rankRates(RATES, "CHEAPEST");
    expect(ranking.tags.get("economy")).toEqual(["CHEAPEST"]);
    expect(ranking.tags.get("express")).toEqual(["FASTEST"]);
    expect(ranking.tags.get("standard")).toEqual([]);
    expect(ranking.preferredId).toBe("economy");
    expect(ranking.order).toEqual(["economy", "mystery", "standard", "express"]);
  });

  it("puts the fastest first for a seller who wants speed, leaving rates with no delivery time last", () => {
    const ranking = rankRates(RATES, "FASTEST");
    expect(ranking.preferredId).toBe("express");
    expect(ranking.order).toEqual(["express", "standard", "economy", "mystery"]);
  });

  it("gives one rate both tags when it is cheapest and fastest, and copes with no rates", () => {
    expect(rankRates([{ id: "only", chargeMinor: 300, estimatedDays: 2 }], "FASTEST").tags.get("only")).toEqual(["CHEAPEST", "FASTEST"]);
    expect(rankRates([], "CHEAPEST")).toEqual({ tags: new Map(), preferredId: null, order: [] });
  });

  it("falls back to the cheapest when no carrier gives a delivery time", () => {
    expect(rankRates([{ id: "a", chargeMinor: 500, estimatedDays: null }, { id: "b", chargeMinor: 400, estimatedDays: null }], "FASTEST").preferredId).toBe("b");
  });
});
