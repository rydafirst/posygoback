import type { EmailMessage } from "../../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../../common/brand/brand";

const vendorClaims = (webUrl: string) => ({ label: "See your claims", url: `${webUrl}/claims` });
const partnerClaims = (webUrl: string) => ({ label: "See the claim", url: `${webUrl}/admin/partnership/claims` });
const partnerTransfers = (webUrl: string) => ({ label: "See the transfer", url: `${webUrl}/admin/partnership/transfers` });

export const CustodyEmails = {
  claimReceived: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.received",
    subject: `We've received your report ${reference}`,
    text: `Thanks for telling us. Our team will look at the evidence and come back to you, usually within five working days. You can follow it under Claims.${EMAIL_SIGN_OFF}`,
    action: vendorClaims(webUrl),
  }),
  claimOpened: (to: string, reference: string, found: string, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.opened",
    subject: `We've opened claim ${reference} for some of your stock`,
    text: `${found} We've opened a claim for you, so there's nothing you need to do. Our team will look into it and email you when it's decided. You can follow it under Claims.${EMAIL_SIGN_OFF}`,
    action: vendorClaims(webUrl),
  }),
  claimSettled: (to: string, reference: string, credit: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.settled",
    subject: `Your claim ${reference} has been settled`,
    text: `${credit ? `We've added ${credit} of wallet credit to your account. You can use it for any fees.` : "We've closed this claim without wallet credit."} Sign in to see the decision.${EMAIL_SIGN_OFF}`,
    action: vendorClaims(webUrl),
  }),
  claimRejected: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.rejected",
    subject: `An update on your claim ${reference}`,
    text: `We weren't able to accept this claim. Sign in to see the reason.${EMAIL_SIGN_OFF}`,
    action: vendorClaims(webUrl),
  }),
  partnerClaimAssessed: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.partner_assessed",
    subject: `Please respond to claim ${reference}`,
    text: `We've looked into a stock problem at your hub and think it happened while the stock was with you. Sign in to read our assessment and add your side before we decide.${EMAIL_SIGN_OFF}`,
    action: { label: "Respond to the claim", url: `${webUrl}/admin/partnership/claims` },
  }),
  partnerClaimDecided: (to: string, reference: string, recovered: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "claims.partner_decided",
    subject: `Claim ${reference} has been decided`,
    text: `${recovered ? `${recovered} has been taken from your balance or deposit to cover it.` : "Nothing has been taken from your balance or deposit."} Sign in to see the decision.${EMAIL_SIGN_OFF}`,
    action: partnerClaims(webUrl),
  }),
  transferRequested: (to: string, reference: string, destination: string, webUrl: string): EmailMessage => ({
    to,
    kind: "transfers.requested",
    subject: `Please send stock to ${destination}`,
    text: `We've asked you to pack and send some stock to ${destination} (${reference}). Sign in to see the items, then add the carrier, tracking number, seal number and a photo when it leaves.${EMAIL_SIGN_OFF}`,
    action: partnerTransfers(webUrl),
  }),
  transferCancelled: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "transfers.cancelled",
    subject: `Stock transfer ${reference} was cancelled`,
    text: `We've cancelled stock transfer ${reference}, so you don't need to send this stock any more. Keep it at your hub as usual.${EMAIL_SIGN_OFF}`,
    action: partnerTransfers(webUrl),
  }),
  transferIncoming: (to: string, reference: string, origin: string, carrier: string, tracking: string, webUrl: string): EmailMessage => ({
    to,
    kind: "transfers.incoming",
    subject: `Stock is on its way to you from ${origin}`,
    text: `${origin} has sent you some stock (${reference}) with ${carrier}. Tracking number: ${tracking}.\n\nWhen it arrives, count every item and record what you received.${EMAIL_SIGN_OFF}`,
    action: partnerTransfers(webUrl),
  }),
  trustSuspended: (to: string, score: number, webUrl: string): EmailMessage => ({
    to,
    kind: "partners.paused_trust",
    subject: "Your hub has been paused",
    text: `Your hub's trust score has dropped to ${score}, below the level we need to keep it open. We've paused new stock and orders and asked for a full stock count. Our team will be in touch.${EMAIL_SIGN_OFF}`,
    action: { label: "Open your partnership", url: `${webUrl}/admin/partnership` },
  }),
};
