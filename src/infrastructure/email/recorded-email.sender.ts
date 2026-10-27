import { Logger } from "@nestjs/common";

import type { PrismaService } from "../../database/prisma.service";
import type { EmailMessage, EmailSender, EmailTransport } from "./email.port";

const CODE_LIKE = /\b\d{4,8}\b/g;

export function loggedSubject(subject: string): string {
  return subject.replace(CODE_LIKE, "••••••").slice(0, 200);
}

export class RecordedEmailSender implements EmailSender {
  private readonly logger = new Logger("Email");

  constructor(
    private readonly transport: EmailTransport,
    private readonly prisma: PrismaService,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const entry = { toAddress: message.to.toLowerCase().slice(0, 254), kind: (message.kind ?? "general").slice(0, 60), subject: loggedSubject(message.subject) };
    try {
      const receipt = await this.transport.deliver(message);
      await this.record({ ...entry, status: "SENT", providerId: receipt.providerId?.slice(0, 100) ?? null });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      this.logger.error(`Couldn't send "${entry.kind}" to ${entry.toAddress}: ${reason}`);
      await this.record({ ...entry, status: "FAILED", error: reason });
    }
  }

  private async record(row: { toAddress: string; kind: string; subject: string; status: "SENT" | "FAILED"; providerId?: string | null; error?: string }): Promise<void> {
    await this.prisma.emailLogEntry.create({ data: row }).catch((error: unknown) => this.logger.warn(`Couldn't record an email: ${error instanceof Error ? error.message : String(error)}`));
  }
}
