import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const CommerceEmails = {
  payoutBankChanged: (to: string, bankSummary: string): EmailMessage => ({
    to,
    subject: "The bank account for your store sales was changed",
    text: `Store sales will now be paid to ${bankSummary}. For your safety we wait a few days before the first payout to a new account. If you didn't make this change, contact us straight away.${EMAIL_SIGN_OFF}`,
  }),
  orderConfirmed: (to: string, store: string, reference: string, total: string, items: string): EmailMessage => ({
    to,
    subject: `${store}: order ${reference} confirmed`,
    text: `Thank you for your order. We've taken ${total} for:\n\n${items}\n\nWe'll email you the tracking link as soon as your parcel leaves the warehouse.${EMAIL_SIGN_OFF}`,
  }),
  vendorNewOrder: (to: string, reference: string, total: string): EmailMessage => ({
    to,
    subject: `New store order ${reference}`,
    text: `A buyer paid ${total} on your store. The warehouse will pick, pack and send it, and the fulfilment fee comes from your wallet as usual. Your share is paid to your bank once the return window has passed.${EMAIL_SIGN_OFF}`,
  }),
  awaitingFunds: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `Top up to send store order ${reference}`,
    text: `A buyer has paid for store order ${reference}, but your wallet doesn't have enough for the fulfilment fee. Top up and we'll send it straight away.${EMAIL_SIGN_OFF}`,
  }),
  payoutSent: (to: string, reference: string, amount: string): EmailMessage => ({
    to,
    subject: `${amount} on its way for store order ${reference}`,
    text: `We've sent ${amount} for store order ${reference} to your bank account. It usually arrives within a few working days.${EMAIL_SIGN_OFF}`,
  }),
  orderRefunded: (to: string, store: string, reference: string, amount: string): EmailMessage => ({
    to,
    subject: `${store}: refund for order ${reference}`,
    text: `We've refunded ${amount} to the card you paid with. Refunds usually show within 5 to 10 working days.${EMAIL_SIGN_OFF}`,
  }),
  signInLink: (to: string, link: string): EmailMessage => ({
    to,
    subject: "Your sign-in link",
    text: `Use this link to see your orders. It works once and expires in 15 minutes.\n\n${link}\n\nIf you didn't ask for it, you can ignore this email.${EMAIL_SIGN_OFF}`,
  }),
  returnRequested: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `Return requested for store order ${reference}`,
    text: `A buyer has asked to return store order ${reference}. Sign in to see the reason and decide. Your payout for this order is held until it's settled.${EMAIL_SIGN_OFF}`,
  }),
  returnDecided: (to: string, store: string, reference: string, accepted: boolean, note: string): EmailMessage => ({
    to,
    subject: `${store}: your return for order ${reference}`,
    text: `${accepted ? "Your return has been accepted. Your refund is on its way, and we'll confirm it in a separate email." : "The store wasn't able to accept this return."}\n\nMessage from the store: ${note}${EMAIL_SIGN_OFF}`,
  }),
};
