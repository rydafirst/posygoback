import { EMAIL_SIGN_OFF, PLATFORM_NAME } from "../../common/brand/brand";
import type { EmailMessage } from "../../infrastructure/email/email.port";

export const AccountEmails = {
  deactivated: (to: string, accountName: string): EmailMessage => ({
    to,
    kind: "account.deactivated",
    subject: `Your ${PLATFORM_NAME} account has been deactivated`,
    text: `We've deactivated the ${PLATFORM_NAME} account for ${accountName}, so nobody on the team can sign in for now. If you think this is a mistake, reply to this email.${EMAIL_SIGN_OFF}`,
  }),
  reactivated: (to: string, accountName: string, signInUrl: string): EmailMessage => ({
    to,
    kind: "account.reactivated",
    subject: `Your ${PLATFORM_NAME} account is back on`,
    text: `The ${PLATFORM_NAME} account for ${accountName} is active again, so your team can sign in.${EMAIL_SIGN_OFF}`,
    action: { label: "Sign in", url: signInUrl },
  }),
};
