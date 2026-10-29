import { reminderStep } from "./tax-reminders.service";

describe("tax reminder steps", () => {
  it("reminds once at 30, 7 and 1 days out", () => {
    expect(reminderStep(45, null)).toBeNull();
    expect(reminderStep(30, null)).toBe(30);
    expect(reminderStep(20, 30)).toBeNull();
    expect(reminderStep(7, 30)).toBe(7);
    expect(reminderStep(3, 7)).toBeNull();
    expect(reminderStep(1, 7)).toBe(1);
    expect(reminderStep(0, 1)).toBeNull();
  });

  it("catches up with the nearest step when earlier ones were missed", () => {
    expect(reminderStep(5, null)).toBe(7);
    expect(reminderStep(0, 30)).toBe(1);
  });
});
