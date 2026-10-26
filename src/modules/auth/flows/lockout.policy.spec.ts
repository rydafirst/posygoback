import { isLocked, lockMinutesAfter } from "./lockout.policy";

describe("lockout policy", () => {
  it("allows four mistakes without locking", () => {
    expect([1, 2, 3, 4].map(lockMinutesAfter)).toEqual([null, null, null, null]);
  });

  it("backs off progressively and caps at an hour", () => {
    expect([5, 6, 7, 8, 20].map(lockMinutesAfter)).toEqual([1, 5, 15, 60, 60]);
  });

  it("knows when a lock has expired", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(isLocked(new Date("2026-10-25T12:01:00Z"), now)).toBe(true);
    expect(isLocked(new Date("2026-10-25T11:59:00Z"), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
});
