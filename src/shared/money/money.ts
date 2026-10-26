import { currencyDefinition } from "./currency";

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`Cannot combine ${left} with ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

export class InvalidAmountError extends Error {
  constructor(amount: number) {
    super(`Money amounts must be safe integers in minor units, received ${amount}`);
    this.name = "InvalidAmountError";
  }
}

export interface MoneyJson {
  amountMinor: number;
  currency: string;
}

export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: string,
  ) {}

  static of(amountMinor: number, currency: string): Money {
    if (!Number.isSafeInteger(amountMinor)) {
      throw new InvalidAmountError(amountMinor);
    }
    currencyDefinition(currency);
    return new Money(amountMinor, currency);
  }

  static zero(currency: string): Money {
    return Money.of(0, currency);
  }

  static fromJson(json: MoneyJson): Money {
    return Money.of(json.amountMinor, json.currency);
  }

  static sum(items: readonly Money[], currency: string): Money {
    return items.reduce((total, item) => total.add(item), Money.zero(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isSafeInteger(factor)) {
      throw new InvalidAmountError(factor);
    }
    return Money.of(this.amountMinor * factor, this.currency);
  }

  applyBasisPoints(basisPoints: number): Money {
    return Money.of(Math.round((this.amountMinor * basisPoints) / 10_000), this.currency);
  }

  min(other: Money): Money {
    this.assertSameCurrency(other);
    return this.amountMinor <= other.amountMinor ? this : other;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return Math.sign(this.amountMinor - other.amountMinor) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  isNegative(): boolean {
    return this.amountMinor < 0;
  }

  isZero(): boolean {
    return this.amountMinor === 0;
  }

  format(locale: string): string {
    const { minorUnits } = currencyDefinition(this.currency);
    return new Intl.NumberFormat(locale, { style: "currency", currency: this.currency, minimumFractionDigits: minorUnits, maximumFractionDigits: minorUnits }).format(
      this.amountMinor / 10 ** minorUnits,
    );
  }

  toJSON(): MoneyJson {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
