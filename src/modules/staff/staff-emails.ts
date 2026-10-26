import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const StaffEmails = {
  invitation: (to: string, roleLabel: string, link: string, partnerName?: string): EmailMessage => ({
    to,
    subject: partnerName ? `You've been invited to ${partnerName} on Global Fulfilment Network` : "You've been invited to the Global Fulfilment platform console",
    text: `You've been invited to join ${partnerName ?? "the platform team"} as ${roleLabel}. Accept within 3 days and set up two-factor authentication:\n${link}\n\nIf you weren't expecting this, ignore this email.${SIGN_OFF}`,
  }),
  application: (to: string, link: string): EmailMessage => ({
    to,
    subject: "Your fulfilment partner application — set up your account",
    text: `Thanks for applying to become a fulfilment partner. Set a password and turn on two-factor sign-in to continue with your verification steps (the link lasts 3 days):\n${link}\n\nIf you didn't apply, ignore this email and nothing will happen.${SIGN_OFF}`,
  }),
};
