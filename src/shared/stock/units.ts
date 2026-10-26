import type { MeasurementSystem } from "../country/country.schema";

const GRAMS_PER_OUNCE = 28.349523125;
const MILLIMETRES_PER_INCH = 25.4;

export function formatWeight(grams: number, system: MeasurementSystem, locale: string): string {
  const format = (value: number, unit: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  if (system === "IMPERIAL") {
    const ounces = grams / GRAMS_PER_OUNCE;
    return ounces >= 16 ? format(ounces / 16, "lb") : format(ounces, "oz");
  }
  return grams >= 1000 ? format(grams / 1000, "kg") : format(grams, "g");
}

export function formatDimensions(millimetres: readonly number[], system: MeasurementSystem, locale: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (system === "IMPERIAL") {
    return `${millimetres.map((value) => number.format(value / MILLIMETRES_PER_INCH)).join(" × ")} in`;
  }
  return `${millimetres.map((value) => number.format(value / 10)).join(" × ")} cm`;
}

export function toGrams(value: number, unit: "g" | "kg" | "oz" | "lb"): number {
  const factor = { g: 1, kg: 1000, oz: GRAMS_PER_OUNCE, lb: GRAMS_PER_OUNCE * 16 }[unit];
  return Math.round(value * factor);
}

export function toMillimetres(value: number, unit: "cm" | "in"): number {
  return Math.round(value * (unit === "in" ? MILLIMETRES_PER_INCH : 10));
}

export function fromGrams(grams: number, unit: "g" | "kg" | "oz" | "lb"): number {
  const factor = { g: 1, kg: 1000, oz: GRAMS_PER_OUNCE, lb: GRAMS_PER_OUNCE * 16 }[unit];
  return Math.round((grams / factor) * 100) / 100;
}

export function fromMillimetres(millimetres: number, unit: "cm" | "in"): number {
  return Math.round((millimetres / (unit === "in" ? MILLIMETRES_PER_INCH : 10)) * 10) / 10;
}
