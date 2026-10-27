import type { EmailAction, EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

const openReturns = (webUrl: string): EmailAction => ({ label: "Open your returns", url: `${webUrl}/returns` });

export const ReturnEmails = {
  arrived: (to: string, reference: string, received: number, instructBy: string, webUrl: string): EmailMessage => ({
    to,
    kind: "return.arrived",
    subject: `Return ${reference} has arrived`,
    text: `We've received ${received} ${received === 1 ? "item" : "items"} for return ${reference} and photographed them. Tell us what to do with each one (put back on sale, dispose of or donate) by ${instructBy}. If we don't hear from you by then, we'll put everything back on sale.${EMAIL_SIGN_OFF}`,
    action: { label: "Tell us what to do", url: `${webUrl}/returns` },
  }),
  arrivedEmpty: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "return.arrived_empty",
    subject: `Return ${reference} is closed`,
    text: `The hub checked the parcel for return ${reference}, but none of the items on the return were in it, so we've closed the return. Nothing was added to your stock.${EMAIL_SIGN_OFF}`,
    action: openReturns(webUrl),
  }),
  completed: (to: string, reference: string, restocked: number, webUrl: string): EmailMessage => ({
    to,
    kind: "return.completed",
    subject: `Return ${reference} is done`,
    text: `We've finished return ${reference}. ${restocked > 0 ? `${restocked} ${restocked === 1 ? "item is" : "items are"} back in your stock and ready to sell.` : "Nothing was put back on sale, as you asked."}${EMAIL_SIGN_OFF}`,
    action: openReturns(webUrl),
  }),
  expired: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "return.expired",
    subject: `Return ${reference} was closed`,
    text: `Nothing arrived for return ${reference} in time, so we've closed it and put the handling fee back in your wallet. Open a new return if the parcel is still on its way.${EMAIL_SIGN_OFF}`,
    action: openReturns(webUrl),
  }),
  autoRestocked: (to: string, reference: string, webUrl: string): EmailMessage => ({
    to,
    kind: "return.restocked_by_default",
    subject: `Return ${reference}: we put the items back on sale`,
    text: `We didn't get instructions for return ${reference} in time, so the warehouse will put the items back in your stock.${EMAIL_SIGN_OFF}`,
    action: openReturns(webUrl),
  }),
};
