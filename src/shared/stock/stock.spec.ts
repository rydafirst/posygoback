import { barcodeSchema, hasValidGtinCheckDigit, productInputSchema } from "./catalogue.schema";
import { arrivalDateProblem, canApplyInboundAction, inboundActionsFrom, inboundInputSchema, receiveInboundSchema } from "./inbound.schema";
import { formatDimensions, formatWeight, fromGrams, toGrams } from "./units";

const PRODUCT = { code: "wig-blk-16", name: "Body wave wig", countryOfOrigin: "CN", declaredValueMinor: 4500, weightGrams: 350, storageTier: "SMALL" };

describe("catalogue", () => {
  it("checks GTIN check digits", () => {
    expect(hasValidGtinCheckDigit("4006381333931")).toBe(true);
    expect(hasValidGtinCheckDigit("4006381333932")).toBe(false);
    expect(barcodeSchema.safeParse({ value: "036000291452", symbology: "UPC_A" }).success).toBe(true);
    expect(barcodeSchema.safeParse({ value: "036000291453", symbology: "UPC_A" }).success).toBe(false);
    expect(barcodeSchema.safeParse({ value: "INT-0001", symbology: "CODE128" }).success).toBe(true);
  });

  it("normalises product codes and needs all dimensions or none", () => {
    const parsed = productInputSchema.parse(PRODUCT);
    expect(parsed.code).toBe("WIG-BLK-16");
    expect(productInputSchema.safeParse({ ...PRODUCT, lengthMm: 300 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...PRODUCT, lengthMm: 300, widthMm: 200, heightMm: 50 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...PRODUCT, countryOfOrigin: "UK" }).success).toBe(false);
  });
});

describe("inbound", () => {
  const base = { shippingMode: "LOOSE", expectedArrivalDate: "2026-11-02", boxCounts: { SMALL: 2 }, lines: [{ productId: "4b7a1d64-0d2e-4bb4-9c6c-1a8c5d1e0a11", quantity: 40 }] };

  it("matches the shipping mode to the boxes declared", () => {
    expect(inboundInputSchema.safeParse(base).success).toBe(true);
    expect(inboundInputSchema.safeParse({ ...base, shippingMode: "PALLET" }).success).toBe(false);
    expect(inboundInputSchema.safeParse({ ...base, boxCounts: { SMALL: 0 } }).success).toBe(false);
    expect(inboundInputSchema.safeParse({ ...base, lines: [...base.lines, ...base.lines] }).success).toBe(false);
  });

  it("only allows arrival dates in the next six months", () => {
    expect(arrivalDateProblem("2026-10-24", "2026-10-25")).not.toBeNull();
    expect(arrivalDateProblem("2026-10-25", "2026-10-25")).toBeNull();
    expect(arrivalDateProblem("2027-06-01", "2026-10-25")).not.toBeNull();
  });

  it("follows the shipment lifecycle", () => {
    expect(inboundActionsFrom("DRAFT")).toEqual(["SUBMIT", "CANCEL"]);
    expect(canApplyInboundAction("CANCEL", "ARRIVED")).toBe(false);
    expect(canApplyInboundAction("COMPLETE", "ON_HOLD")).toBe(false);
    expect(inboundActionsFrom("RECEIVED")).toEqual([]);
  });

  it("needs photos of the shipment and of any damage", () => {
    const line = { lineId: "4b7a1d64-0d2e-4bb4-9c6c-1a8c5d1e0a11", acceptedQuantity: 38, damagedQuantity: 2 };
    const photo = "9b7a1d64-0d2e-4bb4-9c6c-1a8c5d1e0a11";
    expect(receiveInboundSchema.safeParse({ boxCounts: { SMALL: 2 }, photoFileIds: [], lines: [line] }).success).toBe(false);
    expect(receiveInboundSchema.safeParse({ boxCounts: { SMALL: 2 }, photoFileIds: [photo], lines: [line] }).success).toBe(false);
    expect(receiveInboundSchema.safeParse({ boxCounts: { SMALL: 2 }, photoFileIds: [photo], lines: [{ ...line, damagePhotoFileIds: [photo] }] }).success).toBe(true);
  });
});

describe("units", () => {
  it("stores metric and shows the market's own units", () => {
    expect(formatWeight(350, "METRIC", "en-GB")).toBe("350 g");
    expect(formatWeight(1500, "METRIC", "en-GB")).toBe("1.5 kg");
    expect(formatWeight(907, "IMPERIAL", "en-US")).toBe("2 lb");
    expect(formatDimensions([300, 200, 50], "METRIC", "en-GB")).toBe("30 × 20 × 5 cm");
    expect(toGrams(2, "lb")).toBe(907);
    expect(fromGrams(907, "lb")).toBe(2);
  });
});
