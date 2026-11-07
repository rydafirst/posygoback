import { EMAIL_SIGN_OFF } from "../../common/brand/brand";
import type { EmailMessage } from "../../infrastructure/email/email.port";

export const ChatEmails = {
  newReply: (to: string, preview: string, url: string): EmailMessage => ({
    to,
    kind: "chat.new_reply",
    subject: "New message from the Posygo team",
    text: `You have a new message from our team:\n\n"${preview}"\n\nReply in your messages so we can keep everything in one place.${EMAIL_SIGN_OFF}`,
    action: { label: "Open messages", url },
  }),
};
