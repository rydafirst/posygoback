import type { EmailMessage } from "../../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../../common/brand/brand";

export const ShoppingEmails = {
  confirm: (to: string, reference: string, deliverTo: string, link: string): EmailMessage => ({
    to,
    subject: `Confirm your shopping request ${reference}`,
    text: `Someone asked us to buy items for this email address, to be sent to ${deliverTo}. If that was you, confirm the request within 48 hours:\n\n${link}\n\nIf it wasn't you, ignore this email and nothing will happen.${EMAIL_SIGN_OFF}`,
  }),
  received: (to: string, reference: string, link: string): EmailMessage => ({
    to,
    subject: `We've got your shopping request ${reference}`,
    text: `Thanks. We'll check each item and send you a price for everything, including delivery, usually within one working day. You pay nothing until you accept it.\n\nSee your request: ${link}${EMAIL_SIGN_OFF}`,
  }),
  quoted: (to: string, reference: string, total: string, link: string): EmailMessage => ({
    to,
    subject: `Your price for ${reference}: ${total}`,
    text: `We've priced your request at ${total} including our fee and delivery. The price holds for 7 days. Sign in to see the details and pay.\n\n${link}${EMAIL_SIGN_OFF}`,
  }),
  paid: (to: string, reference: string, total: string): EmailMessage => ({
    to,
    subject: `Paid: ${reference}`,
    text: `We've taken ${total} and we're buying your items now. We'll email you when they're on their way to you.${EMAIL_SIGN_OFF}`,
  }),
  partlyRefunded: (to: string, reference: string, amount: string): EmailMessage => ({
    to,
    subject: `${reference}: some items were out of stock`,
    text: `We couldn't buy everything on ${reference}, so we've refunded ${amount} to your card for the items we couldn't get. Refunds usually show within 5 to 10 working days.${EMAIL_SIGN_OFF}`,
  }),
  shipped: (to: string, reference: string, carrier: string, tracking: string): EmailMessage => ({
    to,
    subject: `${reference} is on its way`,
    text: `Your items have left our warehouse with ${carrier}. Tracking number: ${tracking}.${EMAIL_SIGN_OFF}`,
  }),
  cancelled: (to: string, reference: string, reason: string, refunded: string | null): EmailMessage => ({
    to,
    subject: `${reference} was cancelled`,
    text: `${reason}${refunded ? `\n\nWe've refunded ${refunded} to your card.` : ""}${EMAIL_SIGN_OFF}`,
  }),
};
