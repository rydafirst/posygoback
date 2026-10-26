import type { EmailMessage } from "../../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const CustodyEmails = {
  claimReceived: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `We've received your report ${reference}`,
    text: `Thanks for telling us. Our team will look at the evidence and come back to you, usually within five working days. You can follow it under Claims.${SIGN_OFF}`,
  }),
  claimSettled: (to: string, reference: string, amount: string | null): EmailMessage => ({
    to,
    subject: `Your claim ${reference} has been settled`,
    text: `${amount ? `We've added a credit of ${amount} to your wallet. You can use it for any fees.` : "We've closed this claim without a credit."} Sign in to see the decision.${SIGN_OFF}`,
  }),
  claimRejected: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `An update on your claim ${reference}`,
    text: `We weren't able to accept this claim. Sign in to see the reason.${SIGN_OFF}`,
  }),
  partnerClaimAssessed: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `Please respond to claim ${reference}`,
    text: `We've looked into a stock problem at your hub and think it happened while the stock was with you. Sign in to read our assessment and add your side before we decide.${SIGN_OFF}`,
  }),
  partnerClaimSettled: (to: string, reference: string, recovered: string | null): EmailMessage => ({
    to,
    subject: `Claim ${reference} has been decided`,
    text: `${recovered ? `${recovered} has been taken from your balance or deposit to cover it.` : "Nothing has been taken from your balance or deposit."} Sign in to see the decision.${SIGN_OFF}`,
  }),
  transferRequested: (to: string, reference: string, destination: string): EmailMessage => ({
    to,
    subject: `Please send stock to ${destination}`,
    text: `We've asked you to pack and send some stock to ${destination} (${reference}). Sign in to see the items, then add the carrier, tracking number, seal number and a photo when it leaves.${SIGN_OFF}`,
  }),
  trustSuspended: (to: string, score: number): EmailMessage => ({
    to,
    subject: "Your hub has been paused",
    text: `Your hub's trust score has dropped to ${score}, below the level we need to keep it open. We've paused new stock and orders and asked for a full stock count. Our team will be in touch.${SIGN_OFF}`,
  }),
};
