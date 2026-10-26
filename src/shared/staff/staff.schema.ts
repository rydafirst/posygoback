import { z } from "zod";

import type { Role } from "../access/roles";
import { emailSchema } from "../auth/auth.schema";

export const INVITABLE_STAFF_ROLES = ["WAREHOUSE_OPERATOR", "COUNTRY_OPS", "COMPLIANCE", "FINANCE_ADMIN", "ADMIN"] as const satisfies readonly Role[];
export type InvitableStaffRole = (typeof INVITABLE_STAFF_ROLES)[number];

export const COUNTRY_BOUND_ROLES: readonly Role[] = ["WAREHOUSE_OPERATOR", "COUNTRY_OPS"];

export const inviteStaffSchema = z
  .object({
    email: emailSchema,
    role: z.enum(INVITABLE_STAFF_ROLES),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .superRefine((input, context) => {
    const needsCountry = COUNTRY_BOUND_ROLES.includes(input.role);
    if (needsCountry && !input.countryCode) {
      context.addIssue({ code: "custom", path: ["countryCode"], message: "Choose the country this person works in" });
    }
    if (!needsCountry && input.countryCode) {
      context.addIssue({ code: "custom", path: ["countryCode"], message: "This role covers every country" });
    }
  });
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export interface StaffMemberView {
  userId: string;
  email: string;
  role: Role;
  countryCode: string | null;
  status: string;
  mfaEnrolled: boolean;
}

export interface StaffInvitationView {
  id: string;
  email: string;
  role: InvitableStaffRole;
  countryCode: string | null;
  expiresAt: string;
}

export interface StaffDirectoryView {
  members: StaffMemberView[];
  invitations: StaffInvitationView[];
}

export interface StaffInvitationPreview {
  email: string;
  role: InvitableStaffRole | "FULFILMENT_PARTNER" | "PARTNER_STAFF";
  countryCode: string | null;
  partnerName: string | null;
}
