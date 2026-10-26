import { Global, Module } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { DevelopmentLogEmailSender, InMemoryEmailSender } from "./email.adapters";
import { EMAIL_SENDER, type EmailSender } from "./email.port";

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender => (config.EMAIL_TRANSPORT === "memory" ? new InMemoryEmailSender() : new DevelopmentLogEmailSender()),
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
