import type { EmailMessage } from "../../infrastructure/email/email.port";
import { EMAIL_SIGN_OFF } from "../../common/brand/brand";

export const ReturnEmails = {
  arrived: (to: string, reference: string, received: number, instructBy: string): EmailMessage => ({
    to,
    subject: `Return ${reference} has arrived`,
    text: `We've received ${received} ${received === 1 ? "item" : "items"} for return ${reference} and photographed them. Tell us what to do with each one (put back on sale, dispose of or donate) by ${instructBy}. If we don't hear from you by then, we'll put everything back on sale.${EMAIL_SIGN_OFF}`,
  }),
  completed: (to: string, reference: string, restocked: number): EmailMessage => ({
    to,
    subject: `Return ${reference} is done`,
    text: `We've finished return ${reference}. ${restocked > 0 ? `${restocked} ${restocked === 1 ? "item is" : "items are"} back in your stock and ready to sell.` : "Nothing was put back on sale, as you asked."}${EMAIL_SIGN_OFF}`,
  }),
  expired: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `Return ${reference} was closed`,
    text: `Nothing arrived for return ${reference} in time, so we've closed it and put the handling fee back in your wallet. Open a new return if the parcel is still on its way.${EMAIL_SIGN_OFF}`,
  }),
  autoRestocked: (to: string, reference: string): EmailMessage => ({
    to,
    subject: `Return ${reference}: we put the items back on sale`,
    text: `We didn't get instructions for return ${reference} in time, so the warehouse will put the items back in your stock.${EMAIL_SIGN_OFF}`,
  }),
};
