import type { ErrorCode } from "./api-error";

export const ERROR_SIDES = ["INPUT", "ACCOUNT", "SYSTEM"] as const;
export type ErrorSide = (typeof ERROR_SIDES)[number];

export interface ErrorGuide {
  side: ErrorSide;
  meaning: string;
  nextStep: string;
  needsSupport: boolean;
}

const input = (meaning: string, nextStep: string): ErrorGuide => ({ side: "INPUT", meaning, nextStep, needsSupport: false });
const account = (meaning: string, nextStep: string, needsSupport = false): ErrorGuide => ({ side: "ACCOUNT", meaning, nextStep, needsSupport });
const system = (meaning: string): ErrorGuide => ({ side: "SYSTEM", meaning, nextStep: "What you've typed on this page is still there, so you can try again in a few minutes.", needsSupport: true });

export const ERROR_GUIDE: Record<ErrorCode, ErrorGuide> = {
  validation_failed: input("Some details in the form aren't in the format we need.", "Fix the fields marked in red. I can explain any of them."),
  unauthenticated: account("You're not signed in, or your sign-in has expired.", "Sign in again, then come back to this page."),
  forbidden: account("Your account doesn't have permission for this.", "Ask the owner of your account to change your role."),
  not_found: input("What you're looking for doesn't exist or has been removed.", "Check the link, or go back to the list and pick it again."),
  rate_limited: input("There were too many attempts in a short time.", "Wait a minute, then try again."),
  invalid_credentials: input("The email or password doesn't match an account.", "Check both, or reset your password."),
  account_locked: account("Your account is locked after several failed sign-ins.", "Wait a little, or reset your password to unlock it."),
  email_not_verified: account("You haven't confirmed your email address yet.", "Open the link we emailed you, or ask for a new one."),
  invalid_code: input("That code doesn't match.", "Check you're using the newest code and type it again."),
  code_expired: input("That code has expired.", "Ask for a new code and use it straight away."),
  mfa_enrolment_required: account("Your account needs two-step sign-in set up first.", "Finish the two-step setup to continue."),
  mfa_already_enrolled: input("Two-step sign-in is already set up on this account.", "There's nothing more to do here."),
  session_revoked: account("Your session was ended, perhaps from another device.", "Sign in again."),
  refresh_superseded: account("Your session was renewed in another tab at the same moment.", "Try again; it will work now."),
  account_inactive: account("This account isn't active.", "Our team needs to look at it with you.", true),
  country_unavailable: input("We're not open for sellers in that country yet.", "Choose a country that's open."),
  country_exists: input("That country is already set up.", "Edit the existing country instead."),
  invalid_transition: input("This action doesn't fit where the item is now, for example it has already moved on.", "Refresh the page to see its latest state."),
  origin_rejected: system("Your browser sent the request in a way our security checks didn't accept."),
  upload_rejected: input("The file wasn't accepted.", "Check its type and size, then upload it again."),
  insufficient_funds: input("Your wallet doesn't have enough money for this.", "Top up your wallet, then try again."),
  wallet_unavailable: account("Your wallet is frozen.", "Our team needs to look at it with you.", true),
  payment_not_ready: system("A payment update arrived before we were ready to apply it."),
  insufficient_stock: input("There isn't enough stock in one hub for this.", "Send more stock, or lower the quantities."),
  carrier_failed: system("The delivery company didn't accept the request."),
  daily_limit_reached: account("You've reached today's limit for this action.", "Try again tomorrow, or ask another approver."),
  fee_schedule_missing: system("Prices for this market aren't set up yet."),
  internal_error: system("Something failed on our side."),
};

const UNKNOWN: ErrorGuide = system("Something failed on our side.");

export function errorGuide(code: string | null | undefined, status = 0): ErrorGuide {
  const known = code ? (ERROR_GUIDE as Record<string, ErrorGuide | undefined>)[code] : undefined;
  if (known) {
    return known;
  }
  return status >= 400 && status < 500 ? input("The request wasn't accepted.", "Check the details and try again.") : UNKNOWN;
}
