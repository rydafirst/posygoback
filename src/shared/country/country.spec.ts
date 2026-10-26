import { acceptsNewVendors, canTransitionCountry } from "./country-status.policy";
import { createCountrySchema } from "./country.schema";
import { SEED_COUNTRIES } from "./seed-countries";

describe("country status policy", () => {
  it("only lets a country go live after onboarding", () => {
    expect(canTransitionCountry("PROSPECTIVE", "LIVE")).toBe(false);
    expect(canTransitionCountry("ONBOARDING", "LIVE")).toBe(true);
  });

  it("never reopens a closed country", () => {
    expect(canTransitionCountry("CLOSED", "LIVE")).toBe(false);
    expect(canTransitionCountry("CLOSED", "ONBOARDING")).toBe(false);
  });

  it("accepts vendors only while live", () => {
    expect(acceptsNewVendors("LIVE")).toBe(true);
    expect(acceptsNewVendors("SUSPENDED")).toBe(false);
  });
});

describe("country schema", () => {
  it("accepts every seed country", () => {
    for (const country of SEED_COUNTRIES) {
      expect(createCountrySchema.safeParse(country).success).toBe(true);
    }
  });

  it("rejects an invalid postal code pattern", () => {
    const [first] = SEED_COUNTRIES;
    const broken = structuredClone(first!);
    broken.config.address.postalCodePattern = "([A-Z";
    expect(createCountrySchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const [first] = SEED_COUNTRIES;
    expect(createCountrySchema.safeParse({ ...first, currency: "XYZ" }).success).toBe(false);
  });
});
