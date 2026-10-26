import { HttpException, HttpStatus } from "@nestjs/common";
import { ERROR_CODES, type ErrorCode } from "../../shared";

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super({ code, message, fieldErrors }, status);
  }
}

export const Errors = {
  validation: (fieldErrors: Record<string, string[]>) => new AppException(HttpStatus.BAD_REQUEST, ERROR_CODES.validationFailed, "Some fields need attention.", fieldErrors),
  unauthenticated: (message = "Sign in to continue.") => new AppException(HttpStatus.UNAUTHORIZED, ERROR_CODES.unauthenticated, message),
  sessionRevoked: () => new AppException(HttpStatus.UNAUTHORIZED, ERROR_CODES.sessionRevoked, "Your session has ended."),
  refreshSuperseded: () => new AppException(HttpStatus.CONFLICT, ERROR_CODES.refreshSuperseded, "Your session was refreshed in another tab. Retry."),
  accountInactive: () => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.accountInactive, "This account is not active."),
  forbidden: (message = "You do not have access to this.") => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.forbidden, message),
  notFound: (message = "Not found.") => new AppException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, message),
  invalidCredentials: () => new AppException(HttpStatus.UNAUTHORIZED, ERROR_CODES.invalidCredentials, "Email or password is incorrect."),
  emailNotVerified: () => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.emailNotVerified, "Verify your email before signing in."),
  invalidCode: () => new AppException(HttpStatus.BAD_REQUEST, ERROR_CODES.invalidCode, "That code is not valid."),
  mfaEnrolmentRequired: () => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.mfaEnrolmentRequired, "Set up two-factor authentication to continue."),
  mfaAlreadyEnrolled: () => new AppException(HttpStatus.CONFLICT, ERROR_CODES.mfaAlreadyEnrolled, "Two-factor authentication is already set up."),
  rateLimited: () => new AppException(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.rateLimited, "Too many attempts. Wait a moment and try again."),
  countryUnavailable: () => new AppException(HttpStatus.BAD_REQUEST, ERROR_CODES.countryUnavailable, "That country is not open for new vendors yet."),
  countryExists: () => new AppException(HttpStatus.CONFLICT, ERROR_CODES.countryExists, "That country already exists."),
  invalidTransition: (message: string) => new AppException(HttpStatus.CONFLICT, ERROR_CODES.invalidTransition, message),
  originRejected: () => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.originRejected, "Request origin not allowed."),
  uploadRejected: (message: string) => new AppException(HttpStatus.BAD_REQUEST, ERROR_CODES.uploadRejected, message),
  insufficientFunds: (shortfall: string) => new AppException(HttpStatus.CONFLICT, ERROR_CODES.insufficientFunds, `Your wallet is ${shortfall} short. Top up and try again.`),
  walletUnavailable: () => new AppException(HttpStatus.CONFLICT, ERROR_CODES.walletUnavailable, "This wallet is frozen. Contact us to resolve it."),
  dailyLimitReached: () => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.dailyLimitReached, "You've reached your daily adjustment limit."),
  insufficientStock: (products: string[]) => new AppException(HttpStatus.CONFLICT, ERROR_CODES.insufficientStock, `Not enough stock in one warehouse for: ${products.join(", ")}.`),
  carrierFailed: (message: string) => new AppException(HttpStatus.BAD_GATEWAY, ERROR_CODES.carrierFailed, message),
  paymentNotReady: () => new AppException(HttpStatus.SERVICE_UNAVAILABLE, ERROR_CODES.paymentNotReady, "This payment event can't be applied yet. Send it again later."),
  feeScheduleMissing: () => new AppException(HttpStatus.CONFLICT, ERROR_CODES.feeScheduleMissing, "Prices for this market aren't set yet. Contact us before sending stock."),
};
