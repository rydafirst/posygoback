import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF, PLATFORM_NAME } from "../../common/brand/brand";

const verificationPage = (webUrl: string) => `${webUrl}/verification`;

export interface ActivationReceipt {
  amount: string;
  paidOn: string;
  reference: string;
}

export const OnboardingEmails = {
  verificationReceived: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.verification_submitted",
    subject: "We're checking your business",
    text: `Thanks, we've received your verification. Most reviews finish within one working day, and we'll email you the result.${EMAIL_SIGN_OFF}`,
    action: { label: "View your verification", url: verificationPage(webUrl) },
  }),
  verificationApproved: (to: string, readyToTrade: boolean, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.verification_approved",
    subject: "Your business is verified",
    text: readyToTrade
      ? `Good news: your verification is approved and you can start sending stock.${EMAIL_SIGN_OFF}`
      : `Good news: your verification is approved. Once the vendor agreement is accepted you can start sending stock.${EMAIL_SIGN_OFF}`,
    action: readyToTrade ? { label: "Open your dashboard", url: `${webUrl}/overview` } : { label: "Accept the vendor agreement", url: verificationPage(webUrl) },
  }),
  activationDue: (to: string, fee: string, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.activation_due",
    subject: "You're verified: activate your account",
    text: `Your business is verified and the agreement is accepted. The last step is a one-off activation fee of ${fee}. Once it's paid your account goes live and you can start sending stock. The activation fee isn't refundable.${EMAIL_SIGN_OFF}`,
    action: { label: "Activate your account", url: verificationPage(webUrl) },
  }),
  accountLive: (to: string, receipt: ActivationReceipt | null, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.account_live",
    subject: "Your account is live",
    text: receipt
      ? `Thanks, we've received your activation fee.\n\nActivation fee: ${receipt.amount}\nPaid on: ${receipt.paidOn}\nReference: ${receipt.reference}\n\nYour account is live and you can start sending stock.${EMAIL_SIGN_OFF}`
      : `Your account is live and you can start sending stock.${EMAIL_SIGN_OFF}`,
    action: { label: "Open your dashboard", url: `${webUrl}/overview` },
  }),
  verificationNeedsChanges: (to: string, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.verification_changes_needed",
    subject: "Your verification needs a few changes",
    text: `Our reviewer asked for the following:\n\n${reason}\n\nSign in and update your verification to continue.${EMAIL_SIGN_OFF}`,
    action: { label: "Update your verification", url: verificationPage(webUrl) },
  }),
  verificationRejected: (to: string, reason: string): EmailMessage => ({
    to,
    kind: "onboarding.verification_rejected",
    subject: "We couldn't verify your business",
    text: `We weren't able to approve your verification:\n\n${reason}\n\nReply to this email if you think this is a mistake.${EMAIL_SIGN_OFF}`,
  }),
  teamInvitation: (to: string, businessName: string, link: string): EmailMessage => ({
    to,
    kind: "onboarding.team_invitation",
    subject: `You've been invited to join ${businessName}`,
    text: `${businessName} invited you to their vendor portal. Accept within 7 days:\n${link}\n\nIf you weren't expecting this, ignore this email.${EMAIL_SIGN_OFF}`,
    action: { label: "Accept the invitation", url: link },
  }),
  teamMemberJoined: (to: string, memberEmail: string, webUrl: string): EmailMessage => ({
    to,
    kind: "onboarding.team_member_joined",
    subject: `${memberEmail} has joined your team`,
    text: `${memberEmail} accepted your invitation and can now sign in to your vendor portal. If you didn't expect this, you can remove them from your team settings.${EMAIL_SIGN_OFF}`,
    action: { label: "View your team", url: `${webUrl}/settings/team` },
  }),
  teamMemberRemoved: (to: string, businessName: string): EmailMessage => ({
    to,
    kind: "onboarding.team_member_removed",
    subject: `You've been removed from ${businessName}`,
    text: `${businessName} removed you from their team on ${PLATFORM_NAME}, so you've been signed out and can't sign in to their vendor portal any more. If you think this is a mistake, speak to the business directly.${EMAIL_SIGN_OFF}`,
  }),
};
