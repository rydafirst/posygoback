export interface CurrencyDefinition {
  code: string;
  minorUnits: number;
  symbol: string;
}

const DEFINITIONS: readonly CurrencyDefinition[] = [
  { code: "USD", minorUnits: 2, symbol: "$" },
  { code: "GBP", minorUnits: 2, symbol: "£" },
  { code: "EUR", minorUnits: 2, symbol: "€" },
  { code: "CAD", minorUnits: 2, symbol: "CA$" },
  { code: "NGN", minorUnits: 2, symbol: "₦" },
  { code: "GHS", minorUnits: 2, symbol: "GH₵" },
  { code: "KES", minorUnits: 2, symbol: "KSh" },
  { code: "ZAR", minorUnits: 2, symbol: "R" },
  { code: "AED", minorUnits: 2, symbol: "AED" },
  { code: "JPY", minorUnits: 0, symbol: "¥" },
];

const BY_CODE = new Map(DEFINITIONS.map((definition) => [definition.code, definition]));

export const SUPPORTED_CURRENCY_CODES = DEFINITIONS.map((definition) => definition.code);

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function currencyDefinition(code: string): CurrencyDefinition {
  const definition = BY_CODE.get(code);
  if (!definition) {
    throw new UnsupportedCurrencyError(code);
  }
  return definition;
}

export class UnsupportedCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`Unsupported currency: ${code}`);
    this.name = "UnsupportedCurrencyError";
  }
}
