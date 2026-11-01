import type { ReminderAudience, ReminderKey } from "../../shared";

export interface ReminderDefinition {
  audience: ReminderAudience;
  title: string;
  trigger: string;
  delaysDays: number[];
  subject: string;
  body: string;
  actionLabel: string;
  actionPath: string;
}

export const REMINDER_CATALOGUE: Readonly<Record<ReminderKey, ReminderDefinition>> = {
  SELLER_CONFIRM_EMAIL: {
    audience: "SELLER",
    title: "Confirm your email",
    trigger: "Signed up but hasn't confirmed their email address.",
    delaysDays: [1, 3],
    subject: "Your Posygo account is almost ready",
    body: "You started signing up for Posygo as {name}, but your email address isn't confirmed yet.\n\nOpen the page below, enter your email and press \"Send a new code\". It takes less than a minute.",
    actionLabel: "Confirm my email",
    actionPath: "/verify-email",
  },
  SELLER_VERIFY_BUSINESS: {
    audience: "SELLER",
    title: "Finish business checks",
    trigger: "Confirmed their email but hasn't finished the business checks.",
    delaysDays: [2, 5, 10],
    subject: "Finish setting up {name} on Posygo",
    body: "Your account for {name} is waiting on a few business checks before you can send stock.\n\nPick up where you left off. Everything you've entered so far is saved.",
    actionLabel: "Finish my checks",
    actionPath: "/verification",
  },
  SELLER_ACTIVATION_FEE: {
    audience: "SELLER",
    title: "Pay the activation fee",
    trigger: "Passed the checks but hasn't paid the one-off activation fee.",
    delaysDays: [2, 7],
    subject: "{name} is approved. One step left",
    body: "Good news: {name} has passed our checks.\n\nPay the one-off activation fee and your account goes live, so you can add products and send stock to a hub.",
    actionLabel: "Activate my account",
    actionPath: "/verification",
  },
  SELLER_FIRST_PRODUCT: {
    audience: "SELLER",
    title: "Add a first product",
    trigger: "Account is live but no products have been added.",
    delaysDays: [3],
    subject: "Add your first product to Posygo",
    body: "{name} is live on Posygo. The next step is adding a product: its name, your product code, its value, weight and size.\n\nWith the size added, you'll see delivery prices for every order straight away.",
    actionLabel: "Add a product",
    actionPath: "/products/new",
  },
  SELLER_FIRST_SHIPMENT: {
    audience: "SELLER",
    title: "Send a first shipment",
    trigger: "Has products but hasn't sent any stock to a hub.",
    delaysDays: [5, 14],
    subject: "Ready to send your stock to the UK?",
    body: "Your products are set up. Send one bulk shipment to a Posygo hub and your customers can get their orders in days, not weeks.\n\nTell us what's in the boxes and we'll give you the hub address.",
    actionLabel: "Send a shipment",
    actionPath: "/inbound/new",
  },
  SELLER_QUIET: {
    audience: "SELLER",
    title: "No orders for a while",
    trigger: "Has stock at a hub but no new orders or shipments for 30 days.",
    delaysDays: [30, 60, 90],
    subject: "Your stock is ready when your customers are",
    body: "It's been a while since {name} had an order through Posygo. Your stock is counted and waiting at the hub.\n\nShare your products with your customers, or create an order for any sale you've made elsewhere and we'll pack it the same day.",
    actionLabel: "Create an order",
    actionPath: "/orders/new",
  },
  PARTNER_SEND_FOR_REVIEW: {
    audience: "PARTNER",
    title: "Send application for review",
    trigger: "Started a partner application but hasn't sent it for review.",
    delaysDays: [3, 7],
    subject: "Your Posygo partner application is nearly done",
    body: "Hi {name}, your application to become a Posygo fulfilment partner is saved but hasn't been sent for review yet.\n\nFinish any steps left on your Partnership page, then press \"Send for review\".",
    actionLabel: "Finish my application",
    actionPath: "/admin/partnership",
  },
  PARTNER_PAYOUTS: {
    audience: "PARTNER",
    title: "Set up payouts",
    trigger: "Approved as a partner but hasn't set up payouts.",
    delaysDays: [2],
    subject: "Set up payouts so you can be paid",
    body: "Hi {name}, your hub is live. Set up payouts so your earnings can be sent to your bank.\n\nIt takes a few minutes on our payment provider's secure page.",
    actionLabel: "Set up payouts",
    actionPath: "/admin/partnership",
  },
};
