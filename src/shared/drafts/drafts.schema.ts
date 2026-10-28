import { z } from "zod";

export const DRAFT_MAX_BYTES = 60_000;
export const DRAFT_LIMIT_PER_USER = 50;
export const DRAFT_KEEP_DAYS = 30;

export const draftKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(:[a-z0-9-]+)*$/, "Use lowercase words separated by colons")
  .max(80);

export const saveDraftSchema = z.object({
  data: z.record(z.string(), z.unknown()).refine((data) => JSON.stringify(data).length <= DRAFT_MAX_BYTES, "This draft is too large to save."),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export interface DraftView {
  key: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface DraftResult {
  draft: DraftView | null;
}
