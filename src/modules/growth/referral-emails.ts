import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const ReferralEmails = {
  rewarded: (to: string, amount: string): EmailMessage => ({
    to,
    subject: `${amount} referral credit added to your wallet`,
    text: `Thanks for spreading the word. We've added ${amount} to your wallet. You can use it for any fees.${SIGN_OFF}`,
  }),
};
