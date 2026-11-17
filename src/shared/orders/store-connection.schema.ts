import { z } from "zod";

export const STORE_PLATFORMS = ["SHOPIFY", "WOOCOMMERCE"] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export const STORE_DELIVERY_OUTCOMES = ["CREATED", "DUPLICATE", "SKIPPED", "FAILED"] as const;
export type StoreDeliveryOutcome = (typeof STORE_DELIVERY_OUTCOMES)[number];

export const STORE_CONNECTION_LIMITS = { maxActivePerVendor: 5, recentDeliveries: 8 } as const;

export const createStoreConnectionSchema = z.object({ platform: z.enum(STORE_PLATFORMS), name: z.string().trim().min(2, "Give it a name, like your shop's name").max(60) });
export type CreateStoreConnectionInput = z.infer<typeof createStoreConnectionSchema>;

export const storeSigningSecretSchema = z.object({ secret: z.string().trim().min(16, "Paste the full signing key from Shopify").max(200) });
export type StoreSigningSecretInput = z.infer<typeof storeSigningSecretSchema>;

export interface StoreDeliveryView {
  externalReference: string | null;
  outcome: StoreDeliveryOutcome;
  message: string;
  orderReference: string | null;
  createdAt: string;
}

export interface StoreConnectionView {
  id: string;
  platform: StorePlatform;
  name: string;
  webhookUrl: string;
  ready: boolean;
  lastReceivedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  deliveries: StoreDeliveryView[];
}

export interface StoreConnectionCreatedView extends StoreConnectionView {
  secret: string | null;
}
