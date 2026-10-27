import { deviceLabel } from "./device-label";

describe("device label", () => {
  it("names common browsers and systems in plain words", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on macOS");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Android");
    expect(deviceLabel(null)).toBe("an unrecognised browser");
  });
});
