import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { SecretHasherService } from "../../infrastructure/crypto/secret-hasher.service";
import { Errors } from "../../common/http/app-exception";

@Injectable()
export class ReminderOptOutsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
  ) {}

  stopUrl(email: string): string {
    const address = email.toLowerCase();
    return `${this.config.WEB_PUBLIC_URL}/reminders/stop?e=${Buffer.from(address).toString("base64url")}&t=${this.token(address)}`;
  }

  async stop(encodedEmail: string, token: string): Promise<void> {
    const address = Buffer.from(encodedEmail, "base64url").toString("utf8").toLowerCase();
    if (!this.hasher.matches(this.token(address), token)) {
      throw Errors.notFound();
    }
    await this.prisma.reminderOptOut.createMany({ data: [{ email: address }], skipDuplicates: true });
  }

  async stopped(): Promise<Set<string>> {
    const rows = await this.prisma.reminderOptOut.findMany({ select: { email: true } });
    return new Set(rows.map((row) => row.email));
  }

  private token(address: string): string {
    return this.hasher.keyedHash(`reminders:stop:${address}`);
  }
}
