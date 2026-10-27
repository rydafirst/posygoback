import type { EmailMessage } from "../../infrastructure/email/email.port";
import type { PartnerCheckKind, PartnerDecision, SecurityKind } from "../../shared";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

const DECISION_LINES: Record<PartnerDecision, string> = {
  APPROVE: "You're approved. Your hub is live and can start taking stock.",
  RETURN: "Your application has come back to you. Some steps need another look — sign in to see the notes.",
  REJECT: "We're not able to approve your application.",
  SUSPEND: "Your hub is paused. You won't receive new stock or orders until this is resolved.",
  REINSTATE: "Your hub is open again and can take new stock and orders.",
  OFFBOARD: "We've started closing your hub. We'll arrange for the stock you hold to be collected.",
  TERMINATE: "Your partnership has ended and your account has been closed.",
};

const DECISION_KINDS: Record<PartnerDecision, string> = {
  APPROVE: "partners.approved",
  RETURN: "partners.returned",
  REJECT: "partners.rejected",
  SUSPEND: "partners.suspended",
  REINSTATE: "partners.reinstated",
  OFFBOARD: "partners.offboarding",
  TERMINATE: "partners.terminated",
};

const CLOSING_DECISIONS: readonly PartnerDecision[] = ["REJECT", "TERMINATE"];

const STEP_NAMES: Record<PartnerCheckKind, string> = {
  REFERRAL: "referee",
  IDENTITY: "identity check",
  PROOF_OF_ADDRESS: "proof of address",
  STORAGE_SPACE: "storage space",
  WORK_STATUS: "work and tax declaration",
};

const SECURITY_NAMES: Record<SecurityKind, string> = { DEPOSIT: "deposit", BOND: "bond" };

const partnership = (webUrl: string) => `${webUrl}/admin/partnership`;
const earnings = (webUrl: string) => `${webUrl}/admin/partnership/earnings`;
const stockCounts = (webUrl: string) => `${webUrl}/admin/partnership/stock-counts`;

export const PartnerEmails = {
  applicationSubmitted: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.application_submitted",
    subject: "We've got your partner application",
    text: `Thanks for finishing your verification steps. Your application is now with our team for review. We'll email you when there's an update, and you can check its progress at any time.${EMAIL_SIGN_OFF}`,
    action: { label: "See your application", url: partnership(webUrl) },
  }),
  decided: (to: string, name: string, decision: PartnerDecision, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: DECISION_KINDS[decision],
    subject: `${name}: an update on your partnership`,
    text: `${DECISION_LINES[decision]}\n\nNote from our team: ${reason}${EMAIL_SIGN_OFF}`,
    ...(CLOSING_DECISIONS.includes(decision) ? {} : { action: { label: "Open your partnership", url: partnership(webUrl) } }),
  }),
  checkReviewed: (to: string, check: PartnerCheckKind, accepted: boolean, webUrl: string): EmailMessage => ({
    to,
    kind: accepted ? "partners.check_accepted" : "partners.check_returned",
    subject: accepted ? "A verification step was accepted" : "A verification step needs another look",
    text: `Your ${STEP_NAMES[check]} was ${accepted ? "accepted" : "returned with a note"}. Sign in to see the details.${EMAIL_SIGN_OFF}`,
    action: { label: "See your verification steps", url: partnership(webUrl) },
  }),
  callScheduled: (to: string, when: Date, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.call_scheduled",
    subject: "We've booked a video call to see your storage space",
    text: `We'd like to see your storage space on a short video call on ${when.toUTCString()}. We'll call the phone number on your application.${EMAIL_SIGN_OFF}`,
    action: { label: "See your application", url: partnership(webUrl) },
  }),
  insuranceReviewed: (to: string, accepted: boolean, note: string, webUrl: string): EmailMessage => ({
    to,
    kind: accepted ? "partners.insurance_accepted" : "partners.insurance_returned",
    subject: accepted ? "Your insurance policy was accepted" : "Your insurance policy needs another look",
    text: `${accepted ? "We've checked and accepted the insurance policy you uploaded." : "We couldn't accept the insurance policy you uploaded. Please upload a policy that fixes the problem below."}\n\nNote from our team: ${note}${EMAIL_SIGN_OFF}`,
    action: { label: "Open your partnership", url: partnership(webUrl) },
  }),
  insuranceExpiring: (to: string, days: number, expiresOn: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.insurance_expiring",
    subject: `Your insurance expires in ${days} days`,
    text: `Your insurance policy expires on ${expiresOn}. Upload the renewed policy before then, or your hub will be paused.${EMAIL_SIGN_OFF}`,
    action: { label: "Upload your renewed policy", url: partnership(webUrl) },
  }),
  insuranceExpired: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.insurance_expired",
    subject: "Your insurance has expired",
    text: `Your insurance policy has expired and your hub has been paused. Upload a current policy to have it reviewed.${EMAIL_SIGN_OFF}`,
    action: { label: "Upload a current policy", url: partnership(webUrl) },
  }),
  payoutAccountChanged: (to: string, bankSummary: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.payout_bank_changed",
    subject: "Your payout bank account was changed",
    text: `Payouts will now go to ${bankSummary}. If you didn't make this change, contact us straight away.${EMAIL_SIGN_OFF}`,
    action: { label: "Check your payout details", url: earnings(webUrl) },
  }),
  payoutPaid: (to: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.payout_sent",
    subject: `Payout of ${amount} sent`,
    text: `We've sent a payout of ${amount} to your bank account. It usually arrives within a few working days.${EMAIL_SIGN_OFF}`,
    action: { label: "See your earnings", url: earnings(webUrl) },
  }),
  payoutFailed: (to: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.payout_failed",
    subject: `Your payout of ${amount} didn't go through`,
    text: `We tried to send a payout of ${amount} to your bank account, but the transfer failed. The money is back in your available balance. Check that your payout details are up to date.${EMAIL_SIGN_OFF}`,
    action: { label: "See your earnings", url: earnings(webUrl) },
  }),
  securityConfirmed: (to: string, kind: SecurityKind, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.deposit_confirmed",
    subject: `We've received your ${SECURITY_NAMES[kind]}`,
    text: `We've confirmed your ${SECURITY_NAMES[kind]} of ${amount}. We hold it while your hub is open and while it's being closed.${EMAIL_SIGN_OFF}`,
    action: { label: "Open your partnership", url: partnership(webUrl) },
  }),
  securityReleased: (to: string, kind: SecurityKind, amount: string, drawn: string | null): EmailMessage => ({
    to,
    kind: "partners.deposit_released",
    subject: `Your ${SECURITY_NAMES[kind]} has been released`,
    text: `We've released your ${SECURITY_NAMES[kind]} of ${amount}.${drawn ? ` ${drawn} of it was used to cover claims against your hub.` : ""}${EMAIL_SIGN_OFF}`,
  }),
  stockCountRequested: (to: string, due: Date, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.stock_count_requested",
    subject: "Please count some stock for us",
    text: `We've asked for a quick stock count with a short video. Sign in to see the items and record your count before ${due.toUTCString()}.${EMAIL_SIGN_OFF}`,
    action: { label: "Start the count", url: stockCounts(webUrl) },
  }),
  stockCountMissed: (to: string, due: Date, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.stock_count_missed",
    subject: "We didn't get your stock count",
    text: `The stock count we asked for was due by ${due.toUTCString()}, and we didn't receive it, so it's been recorded as missed. Sign in to see your counts.${EMAIL_SIGN_OFF}`,
    action: { label: "See your stock counts", url: stockCounts(webUrl) },
  }),
  tierRaised: (to: string, tierName: string, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.tier_raised",
    subject: `You've moved up to ${tierName}`,
    text: `Thanks for the clean orders and accurate counts. You've moved up to ${tierName}, so your hub can now hold more stock and higher-value items.${EMAIL_SIGN_OFF}`,
    action: { label: "Open your partnership", url: partnership(webUrl) },
  }),
};
