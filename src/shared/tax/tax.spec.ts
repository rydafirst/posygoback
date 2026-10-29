import { daysUntil, nextDueOn } from "./tax.schema";

describe("tax deadlines", () => {
  it("rolls each kind of deadline forward, keeping the day where the month allows", () => {
    expect(nextDueOn("YEARLY", "2027-01-31")).toBe("2028-01-31");
    expect(nextDueOn("QUARTERLY", "2026-11-07")).toBe("2027-02-07");
    expect(nextDueOn("MONTHLY", "2027-01-31")).toBe("2027-02-28");
    expect(nextDueOn("YEARLY", "2028-02-29")).toBe("2029-02-28");
    expect(nextDueOn("ONCE", "2026-12-01")).toBeNull();
  });

  it("counts whole days to a deadline", () => {
    expect(daysUntil("2026-11-05", "2026-10-29")).toBe(7);
    expect(daysUntil("2026-10-28", "2026-10-29")).toBe(-1);
  });
});
