import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const OnboardingEmails = {
  verificationReceived: (to: string): EmailMessage => ({
    to,
    subject: "We're checking your business",
    text: `Thanks — we've received your verification. Most reviews finish within one working day, and we'll email you the result.${SIGN_OFF}`,
  }),
  verificationApproved: (to: string): EmailMessage => ({
    to,
    subject: "Your business is verified",
    text: `Good news: your verification is approved. Once the vendor agreement is accepted you can start sending stock.${SIGN_OFF}`,
  }),
  verificationNeedsChanges: (to: string, reason: string): EmailMessage => ({
    to,
    subject: "Your verification needs a few changes",
    text: `Our reviewer asked for the following:\n\n${reason}\n\nSign in and update your verification to continue.${SIGN_OFF}`,
  }),
  verificationRejected: (to: string, reason: string): EmailMessage => ({
    to,
    subject: "We couldn't verify your business",
    text: `We weren't able to approve your verification:\n\n${reason}\n\nReply to this email if you think this is a mistake.${SIGN_OFF}`,
  }),
  teamInvitation: (to: string, businessName: string, link: string): EmailMessage => ({
    to,
    subject: `You've been invited to join ${businessName}`,
    text: `${businessName} invited you to their vendor portal. Accept within 7 days:\n${link}\n\nIf you weren't expecting this, ignore this email.${SIGN_OFF}`,
  }),
};
