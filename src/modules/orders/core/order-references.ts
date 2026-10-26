import { randomCode } from "../../stock/inbound/references";

export function orderReference(countryCode: string): string {
  return `ORD-${countryCode}-${randomCode(7)}`;
}

export function recipientContext(orderId: string): string {
  return `order:${orderId}:recipient`;
}
