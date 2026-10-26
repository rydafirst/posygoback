import { CONCURRENT_REFRESH_GRACE_MS, decideRotation, type RotatableSession } from "./rotation.policy";

const comparer = { matches: (a: string, b: string) => a === b };
const now = new Date("2026-10-25T12:00:00Z");

function session(overrides: Partial<RotatableSession> = {}): RotatableSession {
  return {
    refreshTokenHash: "current",
    previousTokenHashes: ["older", "previous"],
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    lastUsedAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

describe("decideRotation", () => {
  it("rotates the current token", () => {
    expect(decideRotation(session(), "current", now, comparer)).toBe("ROTATE");
  });

  it("treats an old token as theft", () => {
    expect(decideRotation(session(), "older", now, comparer)).toBe("REUSE_DETECTED");
    expect(decideRotation(session(), "previous", now, comparer)).toBe("REUSE_DETECTED");
  });

  it("tolerates a second tab racing the rotation it just lost", () => {
    const justRotated = session({ lastUsedAt: new Date(now.getTime() - CONCURRENT_REFRESH_GRACE_MS / 2) });
    expect(decideRotation(justRotated, "previous", now, comparer)).toBe("SUPERSEDED");
    expect(decideRotation(justRotated, "older", now, comparer)).toBe("REUSE_DETECTED");
  });

  it("rejects revoked, expired and unknown tokens", () => {
    expect(decideRotation(session({ revokedAt: now }), "current", now, comparer)).toBe("INVALID");
    expect(decideRotation(session({ expiresAt: now }), "current", now, comparer)).toBe("INVALID");
    expect(decideRotation(session(), "forged", now, comparer)).toBe("INVALID");
  });
});
