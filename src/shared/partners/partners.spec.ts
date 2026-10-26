import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_PARTNER_TIERS, partnerProgramme, tierFor } from "../country/country.schema";
import { DEFAULT_PARTNER_RATES, partnerRates, partnerShare, splitHoldback } from "../finance/fee-schedule";
import { decisionsFrom, PARTNER_STATUSES, PARTNER_TRANSITIONS } from "./partner-lifecycle";
import { partnerApplicationSchema } from "./partner.schema";

const MIGRATION = join(__dirname, "../../../prisma/migrations/20261025000011_partner_verification/migration.sql");

describe("partner lifecycle", () => {
  it("allows exactly the same status moves in the database as in code", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf("enforce_partner_status_transition()");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    const pairs = [...body.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map((match) => `${match[1]}>${match[2]}`).sort();
    const code = PARTNER_STATUSES.flatMap((from) => PARTNER_TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
    expect(pairs).toEqual(code);
  });

  it("approves only from review and reinstates only from suspension", () => {
    expect(decisionsFrom("UNDER_REVIEW")).toEqual(["APPROVE", "RETURN", "REJECT"]);
    expect(decisionsFrom("VERIFYING")).toEqual(["REJECT"]);
    expect(decisionsFrom("SUSPENDED")).toEqual(["REINSTATE", "OFFBOARD"]);
    expect(decisionsFrom("ACTIVE")).toEqual(["SUSPEND", "OFFBOARD"]);
    expect(decisionsFrom("TERMINATED")).toEqual([]);
  });
});

describe("partner earnings", () => {
  it("pays the share of what the vendor paid, plus the founding bonus", () => {
    expect(partnerShare(1000, 7000, false, DEFAULT_PARTNER_RATES)).toBe(700);
    expect(partnerShare(1000, 7000, true, DEFAULT_PARTNER_RATES)).toBe(750);
    expect(partnerShare(1000, 9800, true, DEFAULT_PARTNER_RATES)).toBe(1000);
  });

  it("holds back a share rounded down", () => {
    expect(splitHoldback(175, DEFAULT_PARTNER_RATES)).toEqual({ availableMinor: 140, heldMinor: 35 });
    expect(splitHoldback(4, DEFAULT_PARTNER_RATES)).toEqual({ availableMinor: 4, heldMinor: 0 });
  });

  it("falls back to the default rates for price lists written before revenue shares", () => {
    expect(partnerRates({})).toEqual(DEFAULT_PARTNER_RATES);
    expect(partnerRates({ partner: { receivingPerBoxMinor: 150 } })).toEqual(DEFAULT_PARTNER_RATES);
  });
});

describe("partner programme settings", () => {
  it("fills in defaults for countries set up before the programme", () => {
    const programme = partnerProgramme({});
    expect(programme).toMatchObject({ acceptingApplications: false, depositMinor: 0, insuranceCoverMinor: 0, proofOfAddressRetentionDays: 90 });
    expect(programme.tiers).toEqual(DEFAULT_PARTNER_TIERS);
  });

  it("starts new partners on the first tier", () => {
    expect(tierFor(partnerProgramme({}), 1)).toMatchObject({ name: "Starter", maxStockValueMinor: 50_000 });
    expect(tierFor(partnerProgramme({}), 9).level).toBe(1);
  });
});

describe("partner applications", () => {
  const application = {
    fullName: "Ada Obi",
    email: "ADA@example.com",
    phone: "+44 7700 900123",
    countryCode: "GB",
    city: "Manchester",
    addressLines: ["12 Rose Street"],
    postalCode: "M1 1AA",
    spaceDescription: "A dry, lockable spare room with shelving for about 40 boxes.",
    heardFrom: "COMMUNITY_GROUP",
    referee: { name: "Pastor Bayo", contact: "bayo@example.com", relationship: "Church leader for six years" },
    consent: true,
  };

  it("needs a referee and consent", () => {
    expect(partnerApplicationSchema.parse(application).email).toBe("ada@example.com");
    expect(partnerApplicationSchema.safeParse({ ...application, referee: undefined }).success).toBe(false);
    expect(partnerApplicationSchema.safeParse({ ...application, consent: false }).success).toBe(false);
  });
});
