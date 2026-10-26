import { UnsupportedCurrencyError } from "./currency";
import { CurrencyMismatchError, InvalidAmountError, Money } from "./money";

describe("Money", () => {
  it("adds and subtracts amounts in the same currency", () => {
    const total = Money.of(1250, "GBP").add(Money.of(750, "GBP")).subtract(Money.of(500, "GBP"));
    expect(total.toJSON()).toEqual({ amountMinor: 1500, currency: "GBP" });
  });

  it("refuses to mix currencies", () => {
    expect(() => Money.of(100, "USD").add(Money.of(100, "GBP"))).toThrow(CurrencyMismatchError);
    expect(() => Money.of(100, "USD").compare(Money.of(100, "GBP"))).toThrow(CurrencyMismatchError);
  });

  it("refuses fractional or unsafe amounts", () => {
    expect(() => Money.of(10.5, "USD")).toThrow(InvalidAmountError);
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow(InvalidAmountError);
  });

  it("refuses unknown currencies", () => {
    expect(() => Money.of(100, "XYZ")).toThrow(UnsupportedCurrencyError);
  });

  it("applies basis points with rounding to the nearest minor unit", () => {
    expect(Money.of(1099, "USD").applyBasisPoints(1000).amountMinor).toBe(110);
  });

  it("formats with the currency's own minor units", () => {
    expect(Money.of(132168, "GBP").format("en-GB")).toBe("£1,321.68");
    expect(Money.of(1500, "JPY").format("en-GB")).toBe("JP¥1,500");
  });

  it("sums a list starting from zero in the given currency", () => {
    const total = Money.sum([Money.of(100, "USD"), Money.of(250, "USD")], "USD");
    expect(total.amountMinor).toBe(350);
    expect(Money.sum([], "EUR").isZero()).toBe(true);
  });
});
