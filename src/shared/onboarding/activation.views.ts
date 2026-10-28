export const ACTIVATION_STATES = ["NOT_READY", "DUE", "LIVE"] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

export const ACTIVATION_PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED"] as const;
export type ActivationPaymentStatus = (typeof ACTIVATION_PAYMENT_STATUSES)[number];

export interface ActivationPaymentView {
  id: string;
  status: ActivationPaymentStatus;
  feeMinor: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
}

export interface VendorActivationView {
  state: ActivationState;
  feeMinor: number | null;
  currency: string;
  payment: ActivationPaymentView | null;
}

export interface ActivationStarted {
  live: boolean;
  paymentId: string | null;
  redirectUrl: string | null;
}
