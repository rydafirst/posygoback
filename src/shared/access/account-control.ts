import { z } from "zod";

export const accountActionSchema = z.object({ reason: z.string().trim().min(10).max(500) });
export type AccountActionInput = z.infer<typeof accountActionSchema>;

export interface AccountControlView {
  deactivatedAt: string | null;
  deletable: boolean;
}
