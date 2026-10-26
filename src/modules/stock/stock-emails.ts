import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const StockEmails = {
  received: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `${reference} has been received`,
    text: `Every unit in shipment ${reference} has been counted and matches what you declared. It's now in stock.${SIGN_OFF}`,
  }),
  discrepancy: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `${reference} was received with differences`,
    text: `We've counted shipment ${reference}, but it doesn't match what you declared. Sign in to see the counts and photos.${SIGN_OFF}`,
  }),
  statusChanged: (to: string, reference: string, headline: string, reason: string): EmailMessage => ({
    to,
    subject: `${reference}: ${headline}`,
    text: `${headline} for shipment ${reference}.\n\n${reason}\n\nSign in to reply to the warehouse team.${SIGN_OFF}`,
  }),
  newMessage: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `New message about ${reference}`,
    text: `The warehouse team sent you a message about shipment ${reference}. Sign in to read and reply.${SIGN_OFF}`,
  }),
};
