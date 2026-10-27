import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const ReferralEmails = {
  rewarded: (to: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "referral.reward_credited",
    subject: `${amount} referral credit added to your wallet`,
    text: `Thanks for spreading the word. A business you referred is up and running, so we've added ${amount} to your wallet. You can use it for any fees.${EMAIL_SIGN_OFF}`,
    action: { label: "See your referrals", url: `${webUrl}/settings/referrals` },
  }),
  welcomeCredit: (to: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "referral.welcome_credit",
    subject: `${amount} welcome credit added to your wallet`,
    text: `You joined with a referral and your first stock has arrived, so we've added ${amount} welcome credit to your wallet. You can use it for any fees.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: `${webUrl}/wallet` },
  }),
};
