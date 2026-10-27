import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

const walletPage = (webUrl: string) => `${webUrl}/wallet`;

export type ReversalCause = "refunded" | "disputed";

export const FinanceEmails = {
  lowBalance: (to: string, balance: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.low_balance",
    subject: "Your wallet is running low",
    text: `Your wallet balance is now ${balance}. Top up soon so storage and orders keep going without interruption.${EMAIL_SIGN_OFF}`,
    action: { label: "Top up your wallet", url: walletPage(webUrl) },
  }),
  topUpReceived: (to: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.top_up_received",
    subject: "Your top-up has arrived",
    text: `${amount} has been added to your wallet.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  storageOverdue: (to: string, due: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.storage_overdue",
    subject: "We couldn't take this month's storage fee",
    text: `Storage of ${due} is due and your wallet doesn't cover it. Top up and we'll take it automatically.${EMAIL_SIGN_OFF}`,
    action: { label: "Top up your wallet", url: walletPage(webUrl) },
  }),
  walletFrozen: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.wallet_paused",
    subject: "Your wallet has been paused",
    text: `A payment into your wallet was refunded or disputed and left a shortfall, so we've paused charges while our finance team looks into it. Reply to this email if you have questions.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  walletPausedManually: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.wallet_paused_manually",
    subject: "Your wallet has been paused",
    text: `Our finance team has paused your wallet, so we can't take any fees from it for now. We'll email you when it's back on. Reply to this email if you have questions.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  walletUnpaused: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.wallet_unpaused",
    subject: "Your wallet is back on",
    text: `Our finance team has finished looking at your wallet and switched it back on, so fees can be taken from it as normal again.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  paymentReversed: (to: string, amount: string, cause: ReversalCause, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.payment_reversed",
    subject: `${amount} taken back from your wallet`,
    text: `A card top-up into your wallet was ${cause === "refunded" ? "refunded" : "disputed with your card provider and the dispute was lost"}, so we've taken ${amount} back out of your wallet.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  walletCredited: (to: string, amount: string, reason: string, balance: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.wallet_credited",
    subject: `${amount} wallet credit added`,
    text: `We've added ${amount} wallet credit to your wallet.\n\nReason: ${reason}\n\nYour balance is now ${balance}.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
  walletDebited: (to: string, amount: string, reason: string, balance: string, webUrl: string): EmailMessage => ({
    to,
    kind: "finance.wallet_debited",
    subject: `${amount} taken from your wallet`,
    text: `We've taken ${amount} from your wallet.\n\nReason: ${reason}\n\nYour balance is now ${balance}. Reply to this email if you have questions.${EMAIL_SIGN_OFF}`,
    action: { label: "View your wallet", url: walletPage(webUrl) },
  }),
};
