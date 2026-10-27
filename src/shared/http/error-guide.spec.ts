import { ERROR_CODES } from "./api-error";
import { ERROR_GUIDE, errorGuide } from "./error-guide";

describe("error guide", () => {
  it("explains every error the platform can return", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_GUIDE[code].meaning.length).toBeGreaterThan(10);
      expect(ERROR_GUIDE[code].nextStep.length).toBeGreaterThan(5);
    }
  });

  it("treats every system failure as ours and sends it to support", () => {
    for (const guide of Object.values(ERROR_GUIDE).filter((entry) => entry.side === "SYSTEM")) {
      expect(guide.needsSupport).toBe(true);
    }
  });

  it("treats unknown failures as ours, and unknown rejections as something to check", () => {
    expect(errorGuide("something_new", 500).side).toBe("SYSTEM");
    expect(errorGuide(undefined, 0).side).toBe("SYSTEM");
    expect(errorGuide("something_new", 422).side).toBe("INPUT");
    expect(errorGuide("insufficient_funds", 409).side).toBe("INPUT");
  });
});
