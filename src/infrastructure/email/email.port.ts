export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailDetails {
  title: string;
  rows: ReadonlyArray<readonly [label: string, value: string]>;
}

export interface EmailSignature {
  name: string;
  title: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  kind?: string;
  action?: EmailAction;
  heading?: string;
  eyebrow?: string;
  preheader?: string;
  details?: EmailDetails;
  signature?: EmailSignature;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface DeliveryReceipt {
  providerId: string | null;
}

export interface EmailTransport {
  deliver(message: EmailMessage): Promise<DeliveryReceipt>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");
export const EMAIL_TRANSPORT = Symbol("EMAIL_TRANSPORT");
