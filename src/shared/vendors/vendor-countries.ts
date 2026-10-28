import { z } from "zod";

import type { AddressRules } from "../country/country.schema";

export const MAX_VENDOR_COUNTRIES = 30;

export const SELECTED_COUNTRY_PARAM = "country";

export const addVendorCountrySchema = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/, "Choose a country") });
export type AddVendorCountryInput = z.infer<typeof addVendorCountrySchema>;

export interface VendorCountryView {
  code: string;
  name: string;
  currency: string;
  home: boolean;
  addedAt: string;
  address: AddressRules;
}

export interface VendorCountryFiguresView {
  code: string;
  currency: string;
  balanceMinor: number | null;
  unitsInStorage: number | null;
  ordersToday: number | null;
}

export function withCountry(path: string, countryCode: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${SELECTED_COUNTRY_PARAM}=${encodeURIComponent(countryCode)}`;
}
