import type { EmailMessage } from "../../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../../common/brand/brand";

const yourRequests = (webUrl: string) => ({ label: "See your request", url: `${webUrl}/account?tab=shopping` });

export const ShoppingEmails = {
  confirm: (to: string, reference: string, deliverTo: string, link: string): EmailMessage => ({
    to,
    kind: "shopping.confirm_request",
    subject: `Confirm your shopping request ${reference}`,
    text: `Someone asked us to buy items for this email address, to be sent to ${deliverTo}. If that was you, confirm the request within 48 hours.\n\nIf it wasn't you, ignore this email and nothing will happen.${EMAIL_SIGN_OFF}`,
    action: { label: "Confirm my request", url: link },
  }),
  received: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.received",
    subject: `We've got your shopping request ${reference}`,
    text: `Thanks. We'll check each item and send you a price for everything, including delivery, usually within one working day. You pay nothing until you accept it.${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
  quoted: (to: string, reference: string, total: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.quote_ready",
    subject: `Your price for ${reference}: ${total}`,
    text: `We've priced your request at ${total} including our fee and delivery. The price holds for 7 days. Sign in to see the details and pay.${EMAIL_SIGN_OFF}`,
    action: { label: "See your price", url: `${webUrl}/account?tab=shopping` },
  }),
  paid: (to: string, reference: string, total: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.paid",
    subject: `Paid: ${reference}`,
    text: `We've taken ${total} and we're buying your items now. We'll email you when they're on their way to you.${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
  bought: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.items_bought",
    subject: `We've bought your items for ${reference}`,
    text: `We've bought your items and they're on their way to our warehouse. Once they arrive we'll check them and send them on to you, and email you the tracking number.${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
  partlyRefunded: (to: string, reference: string, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.partly_refunded",
    subject: `${reference}: some items were out of stock`,
    text: `We couldn't buy everything on ${reference}, so we've refunded ${amount} to your card for the items we couldn't get. Refunds usually show within 5 to 10 working days.${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
  shipped: (to: string, reference: string, carrier: string, tracking: string, trackingUrl: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.shipped",
    subject: `${reference} is on its way`,
    text: `Your items have left our warehouse with ${carrier}. Tracking number: ${tracking}.${EMAIL_SIGN_OFF}`,
    action: trackingUrl ? { label: "Track your parcel", url: trackingUrl } : yourRequests(webUrl),
  }),
  delivered: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.delivered",
    subject: `${reference} has been delivered`,
    text: `Your items have been delivered. Thanks for letting us do your shopping.${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
  cancelled: (to: string, reference: string, reason: string, refunded: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "shopping.cancelled",
    subject: `${reference} was cancelled`,
    text: `${reason}${refunded ? `\n\nWe've refunded ${refunded} to your card.` : ""}${EMAIL_SIGN_OFF}`,
    action: yourRequests(webUrl),
  }),
};
