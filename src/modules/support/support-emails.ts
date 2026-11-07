import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const SupportEmails = {
  newCase: (to: string, reference: string, headline: string, what: string, page: string, message: string, webUrl: string): EmailMessage => ({
    to,
    kind: "support.new_case",
    subject: `${reference}: ${headline}`,
    text: `${what}\nPage: ${page}\n\n${message || "No message."}\n\nOpen the support cases page in the admin console to see the steps that led here.${EMAIL_SIGN_OFF}`,
    action: { label: "Open support cases", url: `${webUrl}/admin/support` },
  }),
  caseResolved: (to: string, subject: string, reference: string, note: string, retryPage: string | null, webUrl: string): EmailMessage => ({
    to,
    kind: "support.case_resolved",
    subject,
    text: `Thanks for getting in touch. We've looked into ${reference} and marked it as done.\n\nNote from our team: ${note}${EMAIL_SIGN_OFF}`,
    ...(retryPage ? { action: { label: "Try again", url: `${webUrl}${retryPage}` } } : {}),
  }),
};
