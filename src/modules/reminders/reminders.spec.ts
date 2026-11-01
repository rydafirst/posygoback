import { fillReminder } from "../../shared";
import { nextReminderStep } from "./reminders.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const since = new Date("2026-11-01T10:00:00Z");
const after = (days: number) => new Date(since.getTime() + days * DAY_MS);

describe("nextReminderStep", () => {
  it("waits until the step is due", () => {
    expect(nextReminderStep([2, 5], since, 0, after(1))).toBeNull();
    expect(nextReminderStep([2, 5], since, 0, after(2))).toBe(0);
    expect(nextReminderStep([2, 5], since, 1, after(4))).toBeNull();
    expect(nextReminderStep([2, 5], since, 1, after(5))).toBe(1);
  });

  it("stops once every step is sent", () => {
    expect(nextReminderStep([2, 5], since, 2, after(40))).toBeNull();
  });

  it("leaves people alone once the moment has long passed", () => {
    expect(nextReminderStep([2, 5], since, 0, after(36))).toBeNull();
  });
});

describe("fillReminder", () => {
  it("puts the name in every place it's asked for", () => {
    expect(fillReminder("Hi {name}, {name} is nearly live", "Ada")).toBe("Hi Ada, Ada is nearly live");
  });
});
