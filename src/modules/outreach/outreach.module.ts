import { Module } from "@nestjs/common";

import { CryptoModule } from "../../infrastructure/crypto/crypto.module";
import { AdminOutreachController, PublicOutreachController } from "./outreach.controllers";
import { OutreachContactsService } from "./outreach-contacts.service";
import { OutreachOptOutsService } from "./outreach-opt-outs.service";
import { OUTREACH_PACING_MS, OutreachSenderService } from "./outreach-sender.service";

const PROVIDER_PACING_MS = 600;

@Module({
  imports: [CryptoModule],
  controllers: [AdminOutreachController, PublicOutreachController],
  providers: [OutreachContactsService, OutreachOptOutsService, OutreachSenderService, { provide: OUTREACH_PACING_MS, useValue: PROVIDER_PACING_MS }],
})
export class OutreachModule {}
