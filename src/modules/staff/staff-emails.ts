import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF, PLATFORM_NAME } from "../../common/brand/brand";

export const StaffEmails = {
  invitation: (to: string, roleLabel: string, link: string, partnerName?: string): EmailMessage => ({
    to,
    subject: partnerName ? `You've been invited to ${partnerName} on ${PLATFORM_NAME}` : `You've been invited to the ${PLATFORM_NAME} platform console`,
    text: `You've been invited to join ${partnerName ?? "the platform team"} as ${roleLabel}. Accept within 3 days and set up two-factor authentication:\n${link}\n\nIf you weren't expecting this, ignore this email.${EMAIL_SIGN_OFF}`,
  }),
  application: (to: string, link: string): EmailMessage => ({
    to,
    subject: "Your fulfilment partner application — set up your account",
    text: `Thanks for applying to become a fulfilment partner. Set a password and turn on two-factor sign-in to continue with your verification steps (the link lasts 3 days):\n${link}\n\nIf you didn't apply, ignore this email and nothing will happen.${EMAIL_SIGN_OFF}`,
  }),
};
