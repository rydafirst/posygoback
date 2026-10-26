import { gramsFromOunces, hsCode, millimetresFromInches, productCode, symbology, variantLabel, vendorRole, vendorStatus } from "./us-mapping";

describe("moving US records across", () => {
  it("converts imperial sizes up, never to zero", () => {
    expect(gramsFromOunces(1)).toBe(29);
    expect(gramsFromOunces(0)).toBe(1);
    expect(millimetresFromInches(10)).toBe(254);
    expect(millimetresFromInches(0.1)).toBe(3);
    expect(millimetresFromInches(null)).toBeNull();
    expect(millimetresFromInches(0)).toBeNull();
  });

  it("keeps only vendor accounts and live statuses", () => {
    expect(vendorRole("VENDOR")).toBe("VENDOR_OWNER");
    expect(vendorRole("VENDOR_SUB_USER")).toBe("VENDOR_MEMBER");
    expect(vendorRole("SUPER_ADMIN")).toBeNull();
    expect(vendorStatus("PENDING_KYC")).toBe("PENDING_VERIFICATION");
    expect(vendorStatus("CLOSED")).toBeNull();
  });

  it("cleans codes into the shapes we accept", () => {
    expect(productCode(" tsh blk/m ")).toBe("TSH-BLK-M");
    expect(productCode("--x1")).toBe("X1");
    expect(variantLabel("STD")).toBeUndefined();
    expect(variantLabel("Red / M")).toBe("Red / M");
    expect(hsCode("6109.10")).toBe("610910");
    expect(hsCode("61")).toBeNull();
    expect(symbology("OTHER")).toBe("CODE128");
    expect(symbology("EAN13")).toBe("EAN13");
  });
});
