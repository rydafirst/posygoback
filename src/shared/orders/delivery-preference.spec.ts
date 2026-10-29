import { deliveryTimeLabel, rankRates, serviceKey } from "./delivery-preference";

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

  it("puts the seller's chosen service first, and falls back when the hub isn't offered it", () => {
    const rates = [
      { id: "post", chargeMinor: 266, estimatedDays: null, carrier: "Hermes UK", service: "Postable" },
      { id: "next", chargeMinor: 326, estimatedDays: null, carrier: "Hermes UK", service: "Postable Next Day" },
    ];
    const chosen = rankRates(rates, "CHEAPEST", serviceKey("Hermes UK", "Postable Next Day"));
    expect(chosen.preferredId).toBe("next");
    expect(chosen.order[0]).toBe("next");
    expect(chosen.tags.get("next")).toEqual(["FASTEST"]);
    expect(rankRates(rates, "CHEAPEST", serviceKey("DPD UK", "Next Day")).preferredId).toBe("post");
  });

  it("describes delivery time, reading next day from the service name when the carrier gives none", () => {
    expect(deliveryTimeLabel(3, "Standard")).toBe("About 3 days");
    expect(deliveryTimeLabel(1, "Express")).toBe("Next day");
    expect(deliveryTimeLabel(null, "ParcelShop Drop-Off Next Day")).toBe("Next day");
    expect(deliveryTimeLabel(null, "Postable")).toBeNull();
  });
});
