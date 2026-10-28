import { productDirectoryQuerySchema, productStockState, type StageFacts, vendorDirectoryQuerySchema, vendorStage } from "./vendor-directory";

const fresh: StageFacts = { vendorStatus: "PENDING_VERIFICATION", verificationStatus: null, ownerEmailVerified: false };

describe("vendor stage", () => {
  it("is signed up until the owner verifies their email and starts verification", () => {
    expect(vendorStage(fresh)).toBe("SIGNED_UP");
    expect(vendorStage({ ...fresh, ownerEmailVerified: true })).toBe("SIGNED_UP");
    expect(vendorStage({ ...fresh, ownerEmailVerified: true, verificationStatus: "NOT_STARTED" })).toBe("SIGNED_UP");
  });

  it("is verifying while the business check is open or sent back", () => {
    for (const status of ["IN_PROGRESS", "SUBMITTED", "RESUBMISSION_REQUIRED", "REJECTED"] as const) {
      expect(vendorStage({ ...fresh, ownerEmailVerified: true, verificationStatus: status })).toBe("VERIFYING");
    }
  });

  it("is verified once approved but not yet trading", () => {
    expect(vendorStage({ ...fresh, ownerEmailVerified: true, verificationStatus: "APPROVED" })).toBe("VERIFIED");
  });

  it("is live when active and suspended when suspended or closed", () => {
    expect(vendorStage({ ...fresh, vendorStatus: "ACTIVE", verificationStatus: "APPROVED" })).toBe("LIVE");
    expect(vendorStage({ ...fresh, vendorStatus: "SUSPENDED", verificationStatus: "APPROVED" })).toBe("SUSPENDED");
    expect(vendorStage({ ...fresh, vendorStatus: "CLOSED" })).toBe("SUSPENDED");
  });
});

describe("product stock state", () => {
  it("prefers stock in storage, then stock on the way", () => {
    expect(productStockState({ unitsInStorage: 3, unitsOnTheWay: 5, everStored: true })).toBe("IN_STORAGE");
    expect(productStockState({ unitsInStorage: 0, unitsOnTheWay: 5, everStored: true })).toBe("ON_THE_WAY");
  });

  it("tells sold out apart from never sent", () => {
    expect(productStockState({ unitsInStorage: 0, unitsOnTheWay: 0, everStored: true })).toBe("SOLD_OUT");
    expect(productStockState({ unitsInStorage: 0, unitsOnTheWay: 0, everStored: false })).toBe("NOT_SENT");
  });
});

describe("directory queries", () => {
  it("reads page numbers from the query string and rejects unknown filters", () => {
    expect(vendorDirectoryQuerySchema.parse({ page: "3", stage: "LIVE" })).toEqual({ page: 3, stage: "LIVE" });
    expect(vendorDirectoryQuerySchema.parse({})).toEqual({ page: 1 });
    expect(vendorDirectoryQuerySchema.safeParse({ stage: "HAPPY" }).success).toBe(false);
    expect(productDirectoryQuerySchema.safeParse({ stock: "LOST" }).success).toBe(false);
    expect(productDirectoryQuerySchema.safeParse({ vendorId: "not-an-id" }).success).toBe(false);
  });
});
