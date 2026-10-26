import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nGlobal Fulfilment Network";

export const OrderEmails = {
  awaitingFunds: (to: string, reference: string, amount: string): EmailMessage => ({
    to,
    subject: `${reference} is packed and waiting for shipping funds`,
    text: `Order ${reference} is packed. Shipping costs ${amount}, but your wallet can't cover it yet. Add funds, then pay for shipping on the order page and we'll buy the label straight away.${SIGN_OFF}`,
  }),
  cancelled: (to: string, reference: string, reason: string): EmailMessage => ({
    to,
    subject: `${reference} has been cancelled`,
    text: `Order ${reference} has been cancelled.\n\n${reason}\n\nAny charges for it have been returned to your wallet and the stock is back on the shelf.${SIGN_OFF}`,
  }),
  cancellationRejected: (to: string, reference: string, note: string): EmailMessage => ({
    to,
    subject: `${reference} can't be cancelled`,
    text: `We couldn't cancel order ${reference}.\n\n${note}${SIGN_OFF}`,
  }),
  problem: (to: string, reference: string, description: string): EmailMessage => ({
    to,
    subject: `${reference} needs attention`,
    text: `The carrier reported a problem with order ${reference}: ${description}\n\nSign in to see the latest tracking.${SIGN_OFF}`,
  }),
};
