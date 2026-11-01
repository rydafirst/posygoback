import { Module } from "@nestjs/common";

import { CryptoModule } from "../../infrastructure/crypto/crypto.module";
import { FinanceModule } from "../finance/finance.module";
import { ReminderAudiencesService } from "./reminder-audiences.service";
import { ReminderOptOutsService } from "./reminder-opt-outs.service";
import { ReminderSettingsService } from "./reminder-settings.service";
import { AdminRemindersController, PublicRemindersController } from "./reminders.controllers";
import { ReminderJobs } from "./reminders.jobs";
import { RemindersService } from "./reminders.service";

@Module({
  imports: [FinanceModule, CryptoModule],
  controllers: [AdminRemindersController, PublicRemindersController],
  providers: [ReminderAudiencesService, ReminderOptOutsService, RemindersService, ReminderSettingsService, ReminderJobs],
})
export class RemindersModule {}
