import { hashSecret, newApiKey, parseApiKey, secretMatches } from "../integration/api-key";
import { decimalToMinor, minorToDecimal } from "./carrier-money";
import { SandboxCarrier } from "./sandbox.carrier";
import { ShippoCarrier } from "./shippo.carrier";

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

describe("test carriers", () => {
  it("treats Shippo test keys and the sandbox as test carriers, and live keys as real", () => {
    expect(new ShippoCarrier("shippo_test_abc").practice).toBe(true);
    expect(new ShippoCarrier("shippo_live_abc").practice).toBe(false);
    expect(new SandboxCarrier().practice).toBe(true);
  });
});

describe("Shippo test labels", () => {
  const transaction = { object_id: "abcdef0123456789", status: "SUCCESS", tracking_number: "00000000000000", label_url: "https://example.com/label.pdf" };
  const rate = { providerRateId: "rate_1", carrier: "Hermes UK", carrierCode: "hermes_uk", service: "ParcelShop Drop-Off" };

  afterEach(() => jest.restoreAllMocks());

  it("keeps test tracking numbers unique, because Shippo repeats them", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(transaction), { status: 200 })));
    expect((await new ShippoCarrier("shippo_test_abc").buyLabel(rate, "ORD-1")).trackingNumber).toBe("00000000000000-23456789");
    expect((await new ShippoCarrier("shippo_live_abc").buyLabel(rate, "ORD-1")).trackingNumber).toBe("00000000000000");
  });
});
