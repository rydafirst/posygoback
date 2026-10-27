import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const FinanceEmails = {
  lowBalance: (to: string, balance: string): EmailMessage => ({
    to,
    subject: "Your wallet is running low",
    text: `Your wallet balance is now ${balance}. Top up soon so storage and orders keep going without interruption.${EMAIL_SIGN_OFF}`,
  }),
  topUpReceived: (to: string, amount: string): EmailMessage => ({ to, subject: "Your top-up has arrived", text: `${amount} has been added to your wallet.${EMAIL_SIGN_OFF}` }),
  storageOverdue: (to: string, due: string): EmailMessage => ({
    to,
    subject: "We couldn't take this month's storage fee",
    text: `Storage of ${due} is due and your wallet doesn't cover it. Top up and we'll take it automatically.${EMAIL_SIGN_OFF}`,
  }),
  walletFrozen: (to: string): EmailMessage => ({
    to,
    subject: "Your wallet has been paused",
    text: `A payment into your wallet was refunded or disputed and left a shortfall, so we've paused charges while our finance team looks into it. Reply to this email if you have questions.${EMAIL_SIGN_OFF}`,
  }),
};
