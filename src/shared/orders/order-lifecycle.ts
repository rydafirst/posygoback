export const ORDER_STATUSES = [
  "PENDING_PACKING",
  "PACKING_COMPLETED",
  "AWAITING_SHIPPING_SELECTION",
  "AWAITING_WALLET_FUNDING",
  "SHIPPING_PAID",
  "LABEL_PURCHASED",
  "HANDED_OFF",
  "IN_TRANSIT",
  "DELIVERED",
  "ON_HOLD",
  "EXCEPTION",
  "CANCELLED",
  "RETURNED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PACKING: ["PACKING_COMPLETED", "ON_HOLD", "CANCELLED"],
  PACKING_COMPLETED: ["AWAITING_SHIPPING_SELECTION", "PENDING_PACKING", "ON_HOLD", "CANCELLED"],
  AWAITING_SHIPPING_SELECTION: ["SHIPPING_PAID", "AWAITING_WALLET_FUNDING", "PENDING_PACKING", "ON_HOLD", "CANCELLED"],
  AWAITING_WALLET_FUNDING: ["SHIPPING_PAID", "AWAITING_SHIPPING_SELECTION", "PENDING_PACKING", "ON_HOLD", "CANCELLED"],
  SHIPPING_PAID: ["LABEL_PURCHASED", "AWAITING_SHIPPING_SELECTION", "CANCELLED"],
  LABEL_PURCHASED: ["HANDED_OFF", "IN_TRANSIT", "DELIVERED", "EXCEPTION", "CANCELLED"],
  HANDED_OFF: ["IN_TRANSIT", "DELIVERED", "EXCEPTION", "RETURNED"],
  IN_TRANSIT: ["DELIVERED", "EXCEPTION", "RETURNED"],
  EXCEPTION: ["IN_TRANSIT", "DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  ON_HOLD: ["PENDING_PACKING", "CANCELLED"],
  CANCELLED: [],
  RETURNED: [],
};

export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

export const ORDER_ACTIONS = ["RECORD_PACK", "REPACK", "FETCH_RATES", "SELECT_RATE", "RETRY_LABEL", "HAND_OFF", "HOLD", "RELEASE", "CANCEL", "PAY_SHIPPING", "REQUEST_CANCELLATION"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

const ACTION_FROM: Record<OrderAction, readonly OrderStatus[]> = {
  RECORD_PACK: ["PENDING_PACKING"],
  REPACK: ["PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING"],
  FETCH_RATES: ["PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING"],
  SELECT_RATE: ["AWAITING_SHIPPING_SELECTION"],
  RETRY_LABEL: ["SHIPPING_PAID"],
  HAND_OFF: ["LABEL_PURCHASED"],
  HOLD: ["PENDING_PACKING", "PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING"],
  RELEASE: ["ON_HOLD"],
  CANCEL: ["PENDING_PACKING", "PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING", "SHIPPING_PAID", "LABEL_PURCHASED", "ON_HOLD"],
  PAY_SHIPPING: ["AWAITING_WALLET_FUNDING"],
  REQUEST_CANCELLATION: ["PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING", "SHIPPING_PAID", "LABEL_PURCHASED"],
};

export const VENDOR_ORDER_ACTIONS: readonly OrderAction[] = ["CANCEL", "PAY_SHIPPING", "REQUEST_CANCELLATION"];
export const VENDOR_CANCELLABLE: readonly OrderStatus[] = ["PENDING_PACKING", "ON_HOLD"];
export const FULFILMENT_ORDER_ACTIONS: readonly OrderAction[] = ["RECORD_PACK", "REPACK", "FETCH_RATES", "SELECT_RATE", "RETRY_LABEL", "HAND_OFF", "HOLD", "RELEASE"];
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING_PACKING",
  "PACKING_COMPLETED",
  "AWAITING_SHIPPING_SELECTION",
  "AWAITING_WALLET_FUNDING",
  "SHIPPING_PAID",
  "LABEL_PURCHASED",
  "ON_HOLD",
];

export const HUB_ORDER_STAGES = ["OPEN", "SENT", "DONE"] as const;
export type HubOrderStage = (typeof HUB_ORDER_STAGES)[number];

export const HUB_STAGE_STATUSES: Record<HubOrderStage, readonly OrderStatus[]> = {
  OPEN: OPEN_ORDER_STATUSES,
  SENT: ["HANDED_OFF", "IN_TRANSIT", "EXCEPTION"],
  DONE: ["DELIVERED", "RETURNED", "CANCELLED"],
};

export function orderActionAllowed(action: OrderAction, status: OrderStatus): boolean {
  return ACTION_FROM[action].includes(status);
}

export function vendorOrderActions(status: OrderStatus, cancellationPending: boolean): OrderAction[] {
  return VENDOR_ORDER_ACTIONS.filter((action) => {
    if (action === "CANCEL") {
      return VENDOR_CANCELLABLE.includes(status);
    }
    if (action === "REQUEST_CANCELLATION") {
      return !cancellationPending && orderActionAllowed(action, status);
    }
    return orderActionAllowed(action, status);
  });
}

export function staffOrderActions(status: OrderStatus, can: { fulfil: boolean; cancel: boolean }): OrderAction[] {
  const fulfil = can.fulfil ? FULFILMENT_ORDER_ACTIONS.filter((action) => orderActionAllowed(action, status)) : [];
  return can.cancel && orderActionAllowed("CANCEL", status) ? [...fulfil, "CANCEL"] : fulfil;
}

export type TrackingStatus = "PRE_TRANSIT" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "FAILURE";

export function statusForTracking(status: TrackingStatus): OrderStatus | null {
  switch (status) {
    case "IN_TRANSIT":
      return "IN_TRANSIT";
    case "DELIVERED":
      return "DELIVERED";
    case "RETURNED":
      return "RETURNED";
    case "FAILURE":
      return "EXCEPTION";
    default:
      return null;
  }
}

export const PUBLIC_TRACKING_STATUSES = ["PROCESSING", "LABEL_CREATED", "WITH_CARRIER", "IN_TRANSIT", "DELIVERED", "PROBLEM", "RETURNED", "CANCELLED"] as const;
export type PublicTrackingStatus = (typeof PUBLIC_TRACKING_STATUSES)[number];

export function publicTrackingStatus(status: OrderStatus): PublicTrackingStatus {
  const map: Record<OrderStatus, PublicTrackingStatus> = {
    PENDING_PACKING: "PROCESSING",
    PACKING_COMPLETED: "PROCESSING",
    AWAITING_SHIPPING_SELECTION: "PROCESSING",
    AWAITING_WALLET_FUNDING: "PROCESSING",
    SHIPPING_PAID: "PROCESSING",
    ON_HOLD: "PROCESSING",
    LABEL_PURCHASED: "LABEL_CREATED",
    HANDED_OFF: "WITH_CARRIER",
    IN_TRANSIT: "IN_TRANSIT",
    DELIVERED: "DELIVERED",
    EXCEPTION: "PROBLEM",
    RETURNED: "RETURNED",
    CANCELLED: "CANCELLED",
  };
  return map[status];
}
