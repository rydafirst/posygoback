import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

const yourStore = (webUrl: string) => ({ label: "Open your store", url: `${webUrl}/storefront` });
const yourOrders = (webUrl: string) => ({ label: "See your orders", url: `${webUrl}/account` });

export const CommerceEmails = {
  payoutBankChanged: (to: string, bankSummary: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.payout_bank_changed",
    subject: "The bank account for your store sales was changed",
    text: `Store sales will now be paid to ${bankSummary}. For your safety we wait a few days before the first payout to a new account. If you didn't make this change, contact us straight away.${EMAIL_SIGN_OFF}`,
    action: { label: "Check your payout details", url: `${webUrl}/storefront` },
  }),
  orderConfirmed: (to: string, store: string, reference: string, total: string, items: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.order_confirmed",
    subject: `${store}: order ${reference} confirmed`,
    text: `Thank you for your order. We've taken ${total} for:\n\n${items}\n\nWe'll email you the tracking link as soon as your parcel leaves the warehouse.${EMAIL_SIGN_OFF}`,
    action: yourOrders(webUrl),
  }),
  orderShipped: (to: string, store: string, reference: string, tracking: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "store.order_shipped",
    subject: `${store}: order ${reference} is on its way`,
    text: `Good news: your order has left the warehouse.${tracking ? ` Tracking number: ${tracking}.` : " You can follow it from your orders page."}${EMAIL_SIGN_OFF}`,
    action: tracking ? { label: "Track your parcel", url: `${webUrl}/track/${encodeURIComponent(tracking)}` } : yourOrders(webUrl),
  }),
  vendorNewOrder: (to: string, reference: string, total: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.new_order",
    subject: `New store order ${reference}`,
    text: `A buyer paid ${total} on your store. The warehouse will pick, pack and send it, and the fulfilment fee comes from your wallet as usual. Your share is paid to your bank once the return window has passed.${EMAIL_SIGN_OFF}`,
    action: yourStore(webUrl),
  }),
  awaitingFunds: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.awaiting_funds",
    subject: `Top up to send store order ${reference}`,
    text: `A buyer has paid for store order ${reference}, but your wallet doesn't have enough for the fulfilment fee. Top up and we'll send it straight away.${EMAIL_SIGN_OFF}`,
    action: { label: "Top up your wallet", url: `${webUrl}/wallet` },
  }),
  payoutSent: (to: string, reference: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.payout_sent",
    subject: `${amount} on its way for store order ${reference}`,
    text: `We've sent ${amount} for store order ${reference} to your bank account. It usually arrives within a few working days.${EMAIL_SIGN_OFF}`,
    action: yourStore(webUrl),
  }),
  orderRefunded: (to: string, store: string, reference: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.order_refunded",
    subject: `${store}: refund for order ${reference}`,
    text: `We've refunded ${amount} to the card you paid with. Refunds usually show within 5 to 10 working days.${EMAIL_SIGN_OFF}`,
    action: yourOrders(webUrl),
  }),
  paymentDisputed: (to: string, reference: string, payoutHeld: boolean, webUrl: string): EmailMessage => ({
    to,
    kind: "store.payment_disputed",
    subject: `A buyer disputed the payment for store order ${reference}`,
    text: `The buyer has disputed the payment for store order ${reference} with their card provider.${payoutHeld ? " We'll hold your payout for this order until the dispute is settled." : ""} We'll email you when it's settled.${EMAIL_SIGN_OFF}`,
    action: yourStore(webUrl),
  }),
  disputeClosed: (to: string, reference: string, won: boolean, webUrl: string): EmailMessage => ({
    to,
    kind: "store.dispute_closed",
    subject: `The dispute on store order ${reference} is settled`,
    text: `${won ? "The card provider decided in your favour, so your payout for this order is no longer held for the dispute." : "The card provider decided in the buyer's favour and returned the payment to them."} Sign in to see the order.${EMAIL_SIGN_OFF}`,
    action: yourStore(webUrl),
  }),
  signInLink: (to: string, link: string): EmailMessage => ({
    to,
    kind: "buyer.sign_in_link",
    subject: "Your sign-in link",
    text: `Use the link in this email to see your orders. It works once and expires in 15 minutes.\n\nIf you didn't ask for it, you can ignore this email.${EMAIL_SIGN_OFF}`,
    action: { label: "Sign in", url: link },
  }),
  returnRequested: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "store.return_requested",
    subject: `Return requested for store order ${reference}`,
    text: `A buyer has asked to return store order ${reference}. Sign in to see the reason and decide. Your payout for this order is held until it's settled.${EMAIL_SIGN_OFF}`,
    action: { label: "Decide on the return", url: `${webUrl}/storefront` },
  }),
  returnDecided: (to: string, store: string, reference: string, accepted: boolean, note: string, webUrl: string): EmailMessage => ({
    to,
    kind: accepted ? "store.return_accepted" : "store.return_rejected",
    subject: `${store}: your return for order ${reference}`,
    text: `${accepted ? "Your return has been accepted. Your refund is on its way, and we'll confirm it in a separate email." : "The store wasn't able to accept this return."}\n\nMessage from the store: ${note}${EMAIL_SIGN_OFF}`,
    action: yourOrders(webUrl),
  }),
};
