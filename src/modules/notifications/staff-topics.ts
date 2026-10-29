import type { Permission } from "../../shared";

export interface StaffTopic {
  label: string;
  href: string;
  permission: Permission;
}

export const STAFF_TOPICS = {
  vendorJoined: { label: "New vendors", href: "/admin/vendors", permission: "vendors.read" },
  verifications: { label: "Vendor checks to review", href: "/admin/verifications", permission: "verifications.review" },
  vendorActivated: { label: "Vendors who paid the activation fee", href: "/admin/verifications", permission: "verifications.review" },
  partnerApplied: { label: "New partner applications", href: "/admin/partners", permission: "partners.review" },
  partners: { label: "Partner applications to review", href: "/admin/partners", permission: "partners.review" },
  prices: { label: "Price lists waiting for approval", href: "/admin/fees", permission: "fees.approve" },
  adjustments: { label: "Wallet adjustments to approve", href: "/admin/finance", permission: "finance.approve" },
  partnerPayouts: { label: "Partner payouts to approve", href: "/admin/partners", permission: "partners.finance" },
  claimsToAssess: { label: "Claims to assess", href: "/admin/claims", permission: "claims.assess" },
  claimsToDecide: { label: "Claims to decide", href: "/admin/claims", permission: "claims.decide" },
  alerts: { label: "Open custody alerts", href: "/admin/custody-alerts", permission: "claims.read" },
  inboundSubmitted: { label: "Stock shipments sent by sellers", href: "/admin/receiving", permission: "inbound.receive" },
  inbound: { label: "Stock shipments waiting at the door", href: "/admin/receiving", permission: "inbound.receive" },
  ordersStuck: { label: "Orders on hold or with a carrier problem", href: "/admin/orders", permission: "orders.read" },
  returns: { label: "Returns ready to finish", href: "/admin/returns", permission: "inbound.receive" },
  storeReturns: { label: "Store returns still open", href: "/admin/storefront-returns", permission: "storefronts.read" },
  storePayouts: { label: "Store payouts that failed", href: "/admin/storefront-orders", permission: "storefronts.manage" },
  shoppingToPrice: { label: "Shopping requests to price", href: "/admin/shopping", permission: "shopping.manage" },
  shoppingToBuy: { label: "Paid shopping requests to buy", href: "/admin/shopping", permission: "shopping.manage" },
  shoppingAtWarehouse: { label: "Shopping parcels to book in or send", href: "/admin/shopping-desk", permission: "orders.fulfil" },
  support: { label: "Support cases", href: "/admin/support", permission: "support.manage" },
  taxDeadlines: { label: "Tax deadlines coming up or overdue", href: "/admin/tax", permission: "tax.manage" },
} as const satisfies Record<string, StaffTopic>;

export type StaffTopicKey = keyof typeof STAFF_TOPICS;

export const EMAILED_BY_DEFAULT: ReadonlySet<StaffTopicKey> = new Set(["support", "taxDeadlines"]);

export function isStaffTopic(value: string): value is StaffTopicKey {
  return value in STAFF_TOPICS;
}
