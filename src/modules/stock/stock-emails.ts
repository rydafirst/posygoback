import type { EmailAction, EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF, PLATFORM_NAME } from "../../common/brand/brand";

export interface ShipmentLink {
  id: string;
  reference: string;
}

export interface HubAddress {
  name: string;
  addressLines: string[];
  city: string;
  postalCode: string;
}

export interface SubmittedDetails {
  hub: HubAddress;
  arrival: string;
  charge: string | null;
}

const REPLY = "You can reply to the hub team from the shipment page.";

const openShipment = (webUrl: string, shipment: ShipmentLink): EmailAction => ({ label: "Open the shipment", url: `${webUrl}/inbound/${shipment.id}` });

const addressOf = (hub: HubAddress) => [`${PLATFORM_NAME} ${hub.name}`, ...hub.addressLines, `${hub.city} ${hub.postalCode}`].join("\n");

export const StockEmails = {
  submitted: (to: string, shipment: ShipmentLink, details: SubmittedDetails, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_submitted",
    subject: `${shipment.reference} is submitted`,
    text: `Thanks, shipment ${shipment.reference} is submitted. The hub expects it around ${details.arrival}.\n\nSend it to:\n${addressOf(details.hub)}${
      details.charge
        ? `\n\nWe've taken ${details.charge} from your wallet for receiving and the first month's storage. If you cancel the shipment before the hub checks it in, it goes back to your wallet.`
        : ""
    }${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  arrived: (to: string, shipment: ShipmentLink, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_arrived",
    subject: `${shipment.reference} has arrived at the hub`,
    text: `Shipment ${shipment.reference} has reached the hub and is waiting to be counted. We'll email you again once it's been counted.${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  received: (to: string, shipment: ShipmentLink, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_received",
    subject: `${shipment.reference} has been received`,
    text: `Every unit in shipment ${shipment.reference} has been counted and matches what you declared. It's now in stock.${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  discrepancy: (to: string, shipment: ShipmentLink, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_received_with_differences",
    subject: `${shipment.reference} was received with differences`,
    text: `We've counted shipment ${shipment.reference}, but it doesn't match what you declared. The stock that arrived is ready to sell, and the shipment page shows the counts and photos.${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  onHold: (to: string, shipment: ShipmentLink, reason: string, chargeNotice: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_on_hold",
    subject: `${shipment.reference} is on hold`,
    text: `The hub has paused receiving shipment ${shipment.reference}.\n\n${reason}${chargeNotice ? `\n\n${chargeNotice}` : ""}\n\n${REPLY}${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  released: (to: string, shipment: ShipmentLink, chargeWaived: boolean, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_released",
    subject: `${shipment.reference} is no longer on hold`,
    text: `The hub has taken shipment ${shipment.reference} off hold and is carrying on with it.${chargeWaived ? " You don't need to pay the hold charge." : ""}${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  refused: (to: string, shipment: ShipmentLink, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_refused",
    subject: `${shipment.reference} was refused`,
    text: `The hub has refused shipment ${shipment.reference}.\n\n${reason}\n\n${REPLY}${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  returnRequested: (to: string, shipment: ShipmentLink, reason: string, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_return_requested",
    subject: `${shipment.reference} is being sent back to you`,
    text: `Shipment ${shipment.reference} is being sent back to you.\n\n${reason}\n\n${REPLY}${EMAIL_SIGN_OFF}`,
    action: openShipment(webUrl, shipment),
  }),
  newMessage: (to: string, shipment: ShipmentLink, webUrl: string): EmailMessage => ({
    to,
    kind: "stock.shipment_message",
    subject: `New message about ${shipment.reference}`,
    text: `The hub team sent you a message about shipment ${shipment.reference}. Open the shipment to read it and reply.${EMAIL_SIGN_OFF}`,
    action: { label: "Read the message", url: `${webUrl}/inbound/${shipment.id}` },
  }),
};
