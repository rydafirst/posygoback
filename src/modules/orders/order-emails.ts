import type { EmailAction, EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export interface OrderLink {
  id: string;
  reference: string;
}

export interface ShipmentTracking {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
}

const openOrder = (webUrl: string, order: OrderLink): EmailAction => ({ label: "Open the order", url: `${webUrl}/orders/${order.id}` });

export const OrderEmails = {
  awaitingFunds: (to: string, order: OrderLink, amount: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.awaiting_funds",
    subject: `${order.reference} is packed and waiting for shipping funds`,
    text: `Order ${order.reference} is packed. Shipping costs ${amount}, but your wallet can't cover it yet. Add funds, then pay for shipping on the order page and we'll buy the label straight away.${EMAIL_SIGN_OFF}`,
    action: { label: "Pay for shipping", url: `${webUrl}/orders/${order.id}` },
  }),
  onHold: (to: string, order: OrderLink, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.on_hold",
    subject: `${order.reference} is on hold`,
    text: `The hub has paused order ${order.reference}.\n\n${reason}\n\nIt won't be sent until the hub releases it. You can still cancel it from the order page.${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  released: (to: string, order: OrderLink, webUrl: string): EmailMessage => ({
    to,
    kind: "order.released",
    subject: `${order.reference} is no longer on hold`,
    text: `The hub has taken order ${order.reference} off hold. It's back in the queue to be packed.${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  shipped: (to: string, order: OrderLink, tracking: ShipmentTracking, webUrl: string): EmailMessage => ({
    to,
    kind: "order.shipped",
    subject: `${order.reference} is on its way`,
    text: `${tracking.carrier} has collected order ${order.reference} from the hub.\n\nTracking number: ${tracking.trackingNumber}${tracking.trackingUrl ? `\nTrack it: ${tracking.trackingUrl}` : ""}${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  problem: (to: string, order: OrderLink, description: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.carrier_problem",
    subject: `${order.reference} needs attention`,
    text: `The carrier reported a problem with order ${order.reference}: ${description}\n\nThe order page shows the latest tracking.${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  returnedToHub: (to: string, order: OrderLink, description: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.returned_to_hub",
    subject: `${order.reference} is coming back to the hub`,
    text: `The carrier is sending order ${order.reference} back to the hub. Their latest update: ${description}\n\nThe order page shows the full tracking.${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  cancelled: (to: string, order: OrderLink, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.cancelled",
    subject: `${order.reference} has been cancelled`,
    text: `Order ${order.reference} has been cancelled.\n\n${reason}\n\nAny charges for it have been returned to your wallet and the stock is back on the shelf.${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
  cancellationRejected: (to: string, order: OrderLink, note: string, webUrl: string): EmailMessage => ({
    to,
    kind: "order.cancellation_declined",
    subject: `${order.reference} can't be cancelled`,
    text: `We couldn't cancel order ${order.reference}.\n\n${note}${EMAIL_SIGN_OFF}`,
    action: openOrder(webUrl, order),
  }),
};
