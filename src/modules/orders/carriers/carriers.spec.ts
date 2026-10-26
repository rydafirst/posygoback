import { hashSecret, newApiKey, parseApiKey, secretMatches } from "../integration/api-key";
import { decimalToMinor, minorToDecimal } from "./carrier-money";

describe("carrier amounts", () => {
  it("converts decimal prices to minor units, rounding half up", () => {
    expect(decimalToMinor("12.34", "GBP")).toBe(1234);
    expect(decimalToMinor("7", "USD")).toBe(700);
    expect(decimalToMinor("7.005", "USD")).toBe(701);
    expect(decimalToMinor("1500", "JPY")).toBe(1500);
    expect(decimalToMinor("-1.00", "USD")).toBeNull();
    expect(decimalToMinor("1e3", "USD")).toBeNull();
    expect(minorToDecimal(1234, "GBP")).toBe("12.34");
  });
});

describe("api keys", () => {
  it("only accepts well-formed keys and matches their secret", () => {
    const { key, keyId, secret } = newApiKey(true);
    expect(key).toMatch(/^gfn_live_[0-9a-f]{16}\.[0-9a-f]{64}$/);
    expect(parseApiKey(key)).toEqual({ keyId, secret });
    expect(parseApiKey(`${key}x`)).toBeNull();
    expect(parseApiKey("Bearer something")).toBeNull();
    expect(secretMatches(secret, hashSecret(secret))).toBe(true);
    expect(secretMatches(`${secret.slice(1)}0`, hashSecret(secret))).toBe(false);
  });
});
