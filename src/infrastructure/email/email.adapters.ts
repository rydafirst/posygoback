import { Logger } from "@nestjs/common";

import { plainText, renderHtml } from "./email-layout";
import type { DeliveryReceipt, EmailMessage, EmailTransport } from "./email.port";

const RESEND_URL = "https://api.resend.com/emails";
const RETRY_DELAYS_MS = [500, 1500];
const TIMEOUT_MS = 10_000;

export class DevelopmentLogTransport implements EmailTransport {
  private readonly logger = new Logger("Email");

  deliver(message: EmailMessage): Promise<DeliveryReceipt> {
    this.logger.log(`To ${message.to} · ${message.subject}\n${plainText(message)}`);
    return Promise.resolve({ providerId: null });
  }
}

export class InMemoryEmailSender implements EmailTransport {
  readonly sent: EmailMessage[] = [];

  deliver(message: EmailMessage): Promise<DeliveryReceipt> {
    this.sent.push({ ...message, text: plainText(message) });
    return Promise.resolve({ providerId: null });
  }

  lastTo(recipient: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === recipient);
  }
}

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ResendSettings {
  apiKey: string;
  from: string;
  replyTo: string;
  siteUrl: string;
}

function tag(kind: string): string {
  return kind.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

export class ResendTransport implements EmailTransport {
  constructor(
    private readonly settings: ResendSettings,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async deliver(message: EmailMessage): Promise<DeliveryReceipt> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt(message);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!(error instanceof EmailDeliveryError) || !error.retryable || delay === undefined) {
          throw error;
        }
        await this.wait(delay);
      }
    }
  }

  private async attempt(message: EmailMessage): Promise<DeliveryReceipt> {
    const body = {
      from: this.settings.from,
      to: [message.to],
      subject: message.subject,
      text: plainText(message),
      html: renderHtml(message, this.settings.siteUrl),
      ...(this.settings.replyTo ? { reply_to: this.settings.replyTo } : {}),
      ...(message.kind ? { tags: [{ name: "kind", value: tag(message.kind) }] } : {}),
    };
    let response: Response;
    try {
      response = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmailDeliveryError(`Couldn't reach the email service: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "";
      throw new EmailDeliveryError(`The email service replied ${response.status} ${detail}`.trim(), response.status === 429 || response.status >= 500);
    }
    const sent = (await response.json().catch(() => ({}))) as { id?: string };
    return { providerId: sent.id ?? null };
  }
}
