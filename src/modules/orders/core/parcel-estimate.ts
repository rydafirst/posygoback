import type { ParcelSpec } from "../carriers/carrier.port";

export interface EstimateItem {
  weightGrams: number;
  quantity: number;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

export interface EstimateBox {
  label: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface ParcelEstimate {
  parcel: ParcelSpec;
  boxLabel: string;
  sized: boolean;
}

export const PACKING_ALLOWANCE_GRAMS = 150;
const SPARE_ROOM = 1.15;

const sides = (item: { lengthMm: number; widthMm: number; heightMm: number }) => [item.lengthMm, item.widthMm, item.heightMm].sort((a, b) => b - a);
const volume = (item: { lengthMm: number; widthMm: number; heightMm: number }) => item.lengthMm * item.widthMm * item.heightMm;

function sizedItems(items: readonly EstimateItem[]) {
  return items.flatMap((item) => (item.lengthMm && item.widthMm && item.heightMm ? [{ lengthMm: item.lengthMm, widthMm: item.widthMm, heightMm: item.heightMm, quantity: item.quantity }] : []));
}

function fits(box: EstimateBox, item: { lengthMm: number; widthMm: number; heightMm: number }): boolean {
  const boxSides = sides(box);
  return sides(item).every((side, index) => side <= boxSides[index]!);
}

export function estimateParcel(items: readonly EstimateItem[], boxes: readonly EstimateBox[]): ParcelEstimate | null {
  const ordered = [...boxes].sort((a, b) => volume(a) - volume(b));
  if (ordered.length === 0 || items.length === 0) {
    return null;
  }
  const weightGrams = items.reduce((total, item) => total + item.weightGrams * item.quantity, 0) + PACKING_ALLOWANCE_GRAMS;
  const sized = sizedItems(items);
  const complete = sized.length === items.length;
  const needed = sized.reduce((total, item) => total + volume(item) * item.quantity, 0) * SPARE_ROOM;
  const box =
    sized.length > 0 ? (ordered.find((candidate) => volume(candidate) >= needed && sized.every((item) => fits(candidate, item))) ?? ordered.at(-1)!) : ordered[Math.floor(ordered.length / 2)]!;
  return { parcel: { lengthMm: box.lengthMm, widthMm: box.widthMm, heightMm: box.heightMm, weightGrams }, boxLabel: box.label, sized: complete };
}
