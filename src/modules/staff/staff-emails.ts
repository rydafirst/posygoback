import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF, PLATFORM_NAME } from "../../common/brand/brand";

export const StaffEmails = {
  invitation: (to: string, roleLabel: string, link: string, partnerName?: string): EmailMessage => ({
    to,
    kind: "staff.invitation",
    subject: partnerName ? `You've been invited to ${partnerName} on ${PLATFORM_NAME}` : `You've been invited to the ${PLATFORM_NAME} platform console`,
    text: `You've been invited to join ${partnerName ?? "the platform team"} as ${roleLabel}. Accept within 3 days and set up two-factor authentication:\n${link}\n\nIf you weren't expecting this, ignore this email.${EMAIL_SIGN_OFF}`,
    action: { label: "Accept the invitation", url: link },
  }),
  application: (to: string, link: string): EmailMessage => ({
    to,
    kind: "staff.partner_application",
    subject: "Your fulfilment partner application: set up your account",
    text: `Thanks for applying to become a fulfilment partner. Set a password and turn on two-factor sign-in to continue with your verification steps (the link lasts 3 days):\n${link}\n\nIf you didn't apply, ignore this email and nothing will happen.${EMAIL_SIGN_OFF}`,
    action: { label: "Set up your account", url: link },
  }),
  roleChanged: (to: string, roleLabel: string): EmailMessage => ({
    to,
    kind: "staff.role_changed",
    subject: `Your ${PLATFORM_NAME} role has changed`,
    text: `You now work on the ${PLATFORM_NAME} platform team as ${roleLabel}. Sign in again to see what you can do now.${EMAIL_SIGN_OFF}`,
  }),
  suspended: (to: string, partnerName?: string): EmailMessage => ({
    to,
    kind: "staff.account_suspended",
    subject: `Your ${PLATFORM_NAME} account has been suspended`,
    text: `Your account for ${partnerName ?? `the ${PLATFORM_NAME} platform team`} has been suspended, so you've been signed out and can't sign in for now. If you think this is a mistake, speak to the person who manages your team.${EMAIL_SIGN_OFF}`,
  }),
};
