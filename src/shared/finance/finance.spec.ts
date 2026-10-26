import { FeeQuoteError, feeScheduleSchema, fulfilmentFee, onboardingFee, shippingWithMarkup } from "./fee-schedule";
import { SEED_FEE_SCHEDULES } from "./seed-fee-schedules";
import { grossUpForProcessorFees } from "./wallet.schema";

const schedule = SEED_FEE_SCHEDULES.GB!;

describe("fees", () => {
  it("accepts the seed schedule and refuses a cap below the base", () => {
    expect(feeScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(feeScheduleSchema.safeParse({ ...schedule, fulfilment: { baseMinor: 500, perAdditionalUnitMinor: 99, maxMinor: 100 } }).success).toBe(false);
  });

  it("charges stocking and first month for loose boxes, waiving stocking on a first shipment", () => {
    expect(onboardingFee(schedule, { SMALL: 2, LARGE: 1 }, "LOOSE", false)).toEqual({ stockingMinor: 6400, storageMinor: 3600, waivedMinor: 0, totalMinor: 10000 });
    expect(onboardingFee(schedule, { SMALL: 2 }, "LOOSE", true)).toEqual({ stockingMinor: 2400, storageMinor: 1800, waivedMinor: 2400, totalMinor: 1800 });
  });

  it("charges pallets their monthly rate and boxes on a pallet stocking only", () => {
    expect(onboardingFee(schedule, { PALLET: 1, MEDIUM: 8 }, "PALLET", false)).toEqual({ stockingMinor: 17600, storageMinor: 4500, waivedMinor: 0, totalMinor: 22100 });
    expect(() => onboardingFee(schedule, { PALLET: 1 }, "LOOSE", false)).toThrow(FeeQuoteError);
    expect(() => onboardingFee({ ...schedule, monthlyStorage: { ...schedule.monthlyStorage, PALLET: null } }, { PALLET: 1 }, "PALLET", false)).toThrow(/by quote/);
  });

  it("caps fulfilment and rounds shipping markup up", () => {
    expect(fulfilmentFee(schedule, 1)).toBe(299);
    expect(fulfilmentFee(schedule, 3)).toBe(497);
    expect(fulfilmentFee(schedule, 20)).toBe(1099);
    expect(shippingWithMarkup(schedule, 1001)).toBe(1102);
  });

  it("grosses up a top-up so the vendor receives the amount they asked for", () => {
    expect(grossUpForProcessorFees(10_000, 450, 30)).toBe(10_503);
  });
});
