import { z } from "zod";

import type { Permission } from "../access/permissions";
import type { Role } from "../access/roles";
import type { PartnerStatus } from "../partners/partner-lifecycle";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const VERIFICATION_CODE_LENGTH = 8;

export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email("Enter a valid email address");

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`).max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`), "Enter the 8-digit code");

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, "Recovery codes look like ABCDE-12345");

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "Choose where your stock will live"),
  acceptTerms: z.literal(true, { message: "Accept the terms to continue" }),
  referralCode: z.string().trim().max(40).optional(),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

export const verifyEmailSchema = z.object({ email: emailSchema, code: verificationCodeSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

export const emailOnlySchema = z.object({ email: emailSchema });

export const mfaChallengeSchema = z
  .object({ challengeToken: z.string().min(20).max(2000), code: totpCodeSchema.optional(), recoveryCode: recoveryCodeSchema.optional() })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), { message: "Provide either an authenticator code or a recovery code" });

export const mfaConfirmSchema = z.object({ code: totpCodeSchema, emailCode: verificationCodeSchema.optional() });

export const resetPasswordSchema = z.object({ token: z.string().min(32).max(200), password: passwordSchema });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type MfaState = "VERIFIED" | "NOT_REQUIRED" | "ENROLMENT_REQUIRED";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  vendorId: string | null;
  businessName: string | null;
  vendorStatus: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED" | null;
  countryCode: string | null;
  currency: string | null;
  partnerId: string | null;
  partnerStatus: PartnerStatus | null;
  mfaEnrolled: boolean;
  mfaState: MfaState;
  permissions: readonly Permission[];
}

export interface AuthenticatedResult {
  status: "AUTHENTICATED";
  accessToken: string;
  user: SessionUser;
}

export interface MfaRequiredResult {
  status: "MFA_REQUIRED";
  challengeToken: string;
}

export type LoginResult = AuthenticatedResult | MfaRequiredResult;

export interface MfaEnrolmentStart {
  emailCodeRequired: boolean;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  secret: string;
}

export interface MfaEnrolmentComplete {
  recoveryCodes: string[];
  accessToken: string;
  user: SessionUser;
}
