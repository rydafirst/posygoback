import type { EmailMessage } from "../../infrastructure/email/email.port";
import type { PartnerCheckKind, PartnerStatus } from "../../shared";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

const STATUS_LINES: Partial<Record<PartnerStatus, string>> = {
  VERIFYING: "Your application has come back to you. Some steps need another look — sign in to see the notes.",
  ACTIVE: "You're approved. Your hub is live and can start taking stock.",
  SUSPENDED: "Your hub is paused. You won't receive new stock or orders until this is resolved.",
  OFFBOARDING: "We've started closing your hub. We'll arrange for the stock you hold to be collected.",
  TERMINATED: "Your partnership has ended and your account has been closed.",
  REJECTED: "We're not able to approve your application.",
};

const STEP_NAMES: Record<PartnerCheckKind, string> = {
  REFERRAL: "referee",
  IDENTITY: "identity check",
  PROOF_OF_ADDRESS: "proof of address",
  STORAGE_SPACE: "storage space",
  WORK_STATUS: "work and tax declaration",
};

export const PartnerEmails = {
  statusChanged: (to: string, name: string, status: PartnerStatus, reason: string): EmailMessage => ({
    to,
    subject: `${name}: an update on your partnership`,
    text: `${STATUS_LINES[status] ?? "Your partnership status has changed."}\n\nNote from our team: ${reason}${SIGN_OFF}`,
  }),
  checkReviewed: (to: string, check: PartnerCheckKind, accepted: boolean): EmailMessage => ({
    to,
    subject: accepted ? "A verification step was accepted" : "A verification step needs another look",
    text: `Your ${STEP_NAMES[check]} was ${accepted ? "accepted" : "returned with a note"}. Sign in to see the details.${SIGN_OFF}`,
  }),
  callScheduled: (to: string, when: Date): EmailMessage => ({
    to,
    subject: "We've booked a video call to see your storage space",
    text: `We'd like to see your storage space on a short video call on ${when.toUTCString()}. We'll call the phone number on your application.${SIGN_OFF}`,
  }),
  insuranceExpiring: (to: string, days: number, expiresOn: string): EmailMessage => ({
    to,
    subject: `Your insurance expires in ${days} days`,
    text: `Your insurance policy expires on ${expiresOn}. Upload the renewed policy before then, or your hub will be paused.${SIGN_OFF}`,
  }),
  insuranceExpired: (to: string): EmailMessage => ({
    to,
    subject: "Your insurance has expired",
    text: `Your insurance policy has expired and your hub has been paused. Upload a current policy to have it reviewed.${SIGN_OFF}`,
  }),
  payoutAccountChanged: (to: string, bankSummary: string): EmailMessage => ({
    to,
    subject: "Your payout bank account was changed",
    text: `Payouts will now go to ${bankSummary}. If you didn't make this change, contact us straight away.${SIGN_OFF}`,
  }),
  payoutPaid: (to: string, amount: string): EmailMessage => ({
    to,
    subject: `Payout of ${amount} sent`,
    text: `We've sent a payout of ${amount} to your bank account. It usually arrives within a few working days.${SIGN_OFF}`,
  }),
  stockCountRequested: (to: string, due: Date): EmailMessage => ({
    to,
    subject: "Please count some stock for us",
    text: `We've asked for a quick stock count with a short video. Sign in to see the items and record your count before ${due.toUTCString()}.${SIGN_OFF}`,
  }),
  tierRaised: (to: string, tierName: string): EmailMessage => ({
    to,
    subject: `You've moved up to ${tierName}`,
    text: `Thanks for the clean orders and accurate counts. You've moved up to ${tierName}, so your hub can now hold more stock and higher-value items.${SIGN_OFF}`,
  }),
};
