import { Inject, Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { SecretHasherService } from "../../infrastructure/crypto/secret-hasher.service";

@Injectable()
export class OutreachOptOutsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
  ) {}

  stopUrl(contactId: string): string {
    return `${this.config.WEB_PUBLIC_URL}/outreach/stop?c=${contactId}&t=${this.token(contactId)}`;
  }

  async stop(contactId: string, token: string): Promise<void> {
    if (!this.hasher.matches(this.token(contactId), token)) {
      throw Errors.notFound();
    }
    await this.prisma.outreachContact.updateMany({ where: { id: contactId }, data: { status: "UNSUBSCRIBED" } });
  }

  private token(contactId: string): string {
    return this.hasher.keyedHash(`outreach:stop:${contactId}`);
  }
}
