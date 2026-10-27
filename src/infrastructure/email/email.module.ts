import { Global, Module } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { DevelopmentLogTransport, InMemoryEmailSender, ResendTransport } from "./email.adapters";
import { EMAIL_SENDER, EMAIL_TRANSPORT, type EmailTransport } from "./email.port";
import { RecordedEmailSender } from "./recorded-email.sender";

function transportFor(config: AppConfig): EmailTransport {
  if (config.EMAIL_TRANSPORT === "resend") {
    return new ResendTransport({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM, replyTo: config.EMAIL_REPLY_TO, siteUrl: config.WEB_PUBLIC_URL });
  }
  return config.EMAIL_TRANSPORT === "memory" ? new InMemoryEmailSender() : new DevelopmentLogTransport();
}

@Global()
@Module({
  providers: [
    { provide: EMAIL_TRANSPORT, inject: [APP_CONFIG], useFactory: transportFor },
    { provide: EMAIL_SENDER, inject: [EMAIL_TRANSPORT, PrismaService], useFactory: (transport: EmailTransport, prisma: PrismaService) => new RecordedEmailSender(transport, prisma) },
  ],
  exports: [EMAIL_SENDER, EMAIL_TRANSPORT],
})
export class EmailModule {}
