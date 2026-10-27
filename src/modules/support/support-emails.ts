import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const SupportEmails = {
  newCase: (to: string, reference: string, isError: boolean, what: string, page: string, message: string, webUrl: string): EmailMessage => ({
    to,
    kind: "support.new_case",
    subject: `${reference}: ${isError ? "a user hit an error" : "a user needs help"}`,
    text: `${what}\nPage: ${page}\n\n${message || "No message."}\n\nOpen the support cases page in the admin console to see the steps that led here.${EMAIL_SIGN_OFF}`,
    action: { label: "Open support cases", url: `${webUrl}/admin/support` },
  }),
  caseResolved: (to: string, reference: string, note: string, page: string, webUrl: string): EmailMessage => ({
    to,
    kind: "support.case_resolved",
    subject: "The problem you reported is sorted",
    text: `Thanks for reporting it. We've looked into ${reference} and marked it as sorted.\n\nNote from our team: ${note}${EMAIL_SIGN_OFF}`,
    action: { label: "Try again", url: `${webUrl}${page}` },
  }),
};
