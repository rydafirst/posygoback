import { Logger } from "@nestjs/common";

import type { EmailMessage, EmailSender } from "./email.port";

export class DevelopmentLogEmailSender implements EmailSender {
  private readonly logger = new Logger("Email");

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`To ${message.to} · ${message.subject}\n${message.text}`);
    return Promise.resolve();
  }
}

export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  lastTo(recipient: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === recipient);
  }
}
