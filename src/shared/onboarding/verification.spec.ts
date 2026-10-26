import { SEED_COUNTRIES } from "../country/seed-countries";
import { buildVerificationSchemas } from "./verification.schema";

const gb = SEED_COUNTRIES.find((country) => country.code === "GB")!;
const { draft, submission } = buildVerificationSchemas({ countryCode: "GB", kyc: gb.config.kyc, address: gb.config.address }, "2026-10-25");

const valid = {
  businessType: "LIMITED_COMPANY",
  legalBusinessName: "Adaeze Hair Co Ltd",
  registrationCountryCode: "GB",
  companyNumber: "12345678",
  taxNumber: "GB123456789",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postalCode: "M1 1AA" },
  contactFullName: "Adaeze Okafor",
  contactRole: "Director",
  contactPhone: "+447700900123",
  idType: "PASSPORT",
  idNumber: "123456789",
  idExpiry: "2030-01-01",
  documents: { idFront: "4f0bde3c-1f6e-4c56-9e70-0c5f8b6f1a11", selfie: "4f0bde3c-1f6e-4c56-9e70-0c5f8b6f1a12", businessDocument: "4f0bde3c-1f6e-4c56-9e70-0c5f8b6f1a13" },
  productsDescription: "Human hair wigs and extensions",
  monthlyUnits: "UP_TO_1000",
  monthlyOrders: "UP_TO_500",
  hazards: ["NONE"],
};

describe("verification schemas", () => {
  it("accepts a complete UK limited company", () => {
    expect(submission.safeParse(valid).success).toBe(true);
  });

  it("uses the market's own business and ID types", () => {
    expect(submission.safeParse({ ...valid, businessType: "LLC" }).success).toBe(false);
    expect(submission.safeParse({ ...valid, idType: "DRIVERS_LICENSE" }).success).toBe(false);
  });

  it("applies UK formats only to UK-registered companies", () => {
    expect(submission.safeParse({ ...valid, companyNumber: "NOT-A-NUMBER" }).success).toBe(false);
    const nigerian = { ...valid, registrationCountryCode: "NG", companyNumber: "RC1234567", registeredAddress: { line1: "2 Allen Avenue", city: "Lagos", postalCode: "100271" } };
    expect(submission.safeParse(nigerian).success).toBe(true);
  });

  it("rejects expired ID and asks for the back of non-passport IDs", () => {
    expect(submission.safeParse({ ...valid, idExpiry: "2020-01-01" }).success).toBe(false);
    expect(submission.safeParse({ ...valid, idType: "DRIVING_LICENCE" }).success).toBe(false);
  });

  it("lets drafts be saved half-finished", () => {
    expect(draft.safeParse({ legalBusinessName: "Adaeze Hair Co Ltd" }).success).toBe(true);
  });
});
