import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const ReferralEmails = {
  rewarded: (to: string, amount: string): EmailMessage => ({
    to,
    subject: `${amount} referral credit added to your wallet`,
    text: `Thanks for spreading the word. We've added ${amount} to your wallet. You can use it for any fees.${EMAIL_SIGN_OFF}`,
  }),
};
