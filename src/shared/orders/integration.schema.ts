import { z } from "zod";

import type { OrderStatus } from "./order-lifecycle";
import { externalReferenceSchema } from "./order.schema";
import { recipientSchema } from "./recipient";

export const API_KEY_LIMITS = { maxActivePerVendor: 10 } as const;

export const createApiKeySchema = z.object({ name: z.string().trim().min(2).max(60) });

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreatedView extends ApiKeyView {
  key: string;
}

export const integrationOrderSchema = z
  .object({
    externalReference: externalReferenceSchema,
    recipient: recipientSchema,
    lines: z
      .array(z.object({ productCode: z.string().trim().toUpperCase().min(1).max(40), quantity: z.number().int().min(1).max(1000) }))
      .min(1)
      .max(50),
  })
  .superRefine((order, context) => {
    const codes = order.lines.map((line) => line.productCode);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each product can only appear once" });
    }
  });
export type IntegrationOrderInput = z.infer<typeof integrationOrderSchema>;

export interface IntegrationOrderView {
  reference: string;
  externalReference: string;
  status: OrderStatus;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  createdAt: string;
}
