export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
  fieldErrors?: Record<string, string[]>;
}

export const ERROR_CODES = {
  validationFailed: "validation_failed",
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  notFound: "not_found",
  rateLimited: "rate_limited",
  invalidCredentials: "invalid_credentials",
  accountLocked: "account_locked",
  emailNotVerified: "email_not_verified",
  invalidCode: "invalid_code",
  codeExpired: "code_expired",
  mfaEnrolmentRequired: "mfa_enrolment_required",
  mfaAlreadyEnrolled: "mfa_already_enrolled",
  sessionRevoked: "session_revoked",
  refreshSuperseded: "refresh_superseded",
  accountInactive: "account_inactive",
  countryUnavailable: "country_unavailable",
  countryExists: "country_exists",
  invalidTransition: "invalid_transition",
  originRejected: "origin_rejected",
  uploadRejected: "upload_rejected",
  insufficientFunds: "insufficient_funds",
  walletUnavailable: "wallet_unavailable",
  paymentNotReady: "payment_not_ready",
  insufficientStock: "insufficient_stock",
  carrierFailed: "carrier_failed",
  dailyLimitReached: "daily_limit_reached",
  feeScheduleMissing: "fee_schedule_missing",
  internal: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
