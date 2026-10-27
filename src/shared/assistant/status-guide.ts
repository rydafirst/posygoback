import type { InboundStatus } from "../stock/inbound.schema";
import type { OrderStatus } from "../orders/order-lifecycle";

export interface StageGuide {
  label: string;
  meaning: string;
}

export const ORDER_STAGE_GUIDE: Record<OrderStatus, StageGuide> = {
  PENDING_PACKING: { label: "Waiting to be packed", meaning: "The hub hasn't packed it yet. You can still cancel it." },
  PACKING_COMPLETED: { label: "Packed", meaning: "The hub has packed and photographed the parcel. Shipping is being arranged next." },
  AWAITING_SHIPPING_SELECTION: { label: "Choosing shipping", meaning: "The parcel is packed and a carrier service is being chosen." },
  AWAITING_WALLET_FUNDING: { label: "Needs funds for shipping", meaning: "Your wallet doesn't have enough for the shipping. Top up, then pay the shipping from the order page." },
  SHIPPING_PAID: { label: "Buying label", meaning: "Shipping is paid and the label is being bought from the carrier." },
  LABEL_PURCHASED: { label: "Label ready", meaning: "The label is on the parcel and it's waiting for the carrier to collect it." },
  HANDED_OFF: { label: "With the carrier", meaning: "The carrier has collected the parcel." },
  IN_TRANSIT: { label: "In transit", meaning: "The parcel is on its way to the customer. The tracking link shows where it is." },
  DELIVERED: { label: "Delivered", meaning: "The carrier has delivered the parcel." },
  ON_HOLD: { label: "On hold", meaning: "The order is paused, usually so something can be checked. It can be released or cancelled." },
  EXCEPTION: { label: "Carrier problem", meaning: "The carrier reported a problem, such as a missed delivery or an address issue. The tracking shows the details." },
  CANCELLED: { label: "Cancelled", meaning: "The order was cancelled and won't be sent." },
  RETURNED: { label: "Returned", meaning: "The parcel came back to the hub." },
};

export const INBOUND_STAGE_GUIDE: Record<InboundStatus, StageGuide> = {
  DRAFT: { label: "Draft", meaning: "Not sent to the hub yet. You can still change it, and nothing has been charged." },
  SUBMITTED: { label: "On the way", meaning: "You've submitted it and the charge was taken. The hub expects it around the arrival date." },
  ARRIVED: { label: "Arrived", meaning: "The boxes have reached the hub and are waiting to be counted." },
  ON_HOLD: { label: "On hold", meaning: "The hub has paused receiving. The shipment page says why, and if a hold charge is due you can pay it there." },
  RECEIVED: { label: "Received", meaning: "Everything was counted and matched your list. The stock is ready to sell." },
  DISCREPANCY: {
    label: "Received with differences",
    meaning: "It was counted, but the numbers differ from your list. The stock that arrived is ready to sell, and the shipment page shows the differences.",
  },
  REJECTED: { label: "Refused", meaning: "The hub refused the shipment. The shipment page gives the reason." },
  RETURN_REQUESTED: { label: "Being returned", meaning: "The shipment is being sent back to you." },
  CANCELLED: { label: "Cancelled", meaning: "The shipment was cancelled before it was received." },
};
