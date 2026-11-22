import { z } from "zod";

import { isoCountryCode } from "../country/country.schema";

const apiKeyField = z.string().trim().min(20, "Paste the whole API key").max(120);

export const shopifyPreviewSchema = z.object({ apiKey: apiKeyField });
export type ShopifyPreviewInput = z.infer<typeof shopifyPreviewSchema>;

export const shopifyConnectSchema = z.object({ apiKey: apiKeyField, country: isoCountryCode });
export type ShopifyConnectInput = z.infer<typeof shopifyConnectSchema>;

export type ShopifyRequestOutcome = "ACCEPTED" | "REJECTED" | "FULFILLED" | "CLOSED" | "CANCELLED";

export interface ShopifyRequestView {
  orderName: string;
  outcome: ShopifyRequestOutcome;
  message: string;
  orderReference: string | null;
  createdAt: string;
}

export interface ShopifyShopView {
  shopDomain: string;
  connected: boolean;
  businessName: string | null;
  country: string | null;
  locationName: string | null;
  recent: ShopifyRequestView[];
}
