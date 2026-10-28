import { Global, Module } from "@nestjs/common";

import { AdminEmailAlertsController, NotificationsController } from "./notifications.controller";
import { NotificationsJobs } from "./notifications.jobs";
import { NotificationsService } from "./notifications.service";
import { PersonalNoticesService } from "./personal-notices.service";
import { StaffAlertsService } from "./staff-alerts.service";
import { StaffEmailSettingsService } from "./staff-email-settings.service";

@Global()
@Module({
  controllers: [NotificationsController, AdminEmailAlertsController],
  providers: [NotificationsService, NotificationsJobs, StaffAlertsService, StaffEmailSettingsService, PersonalNoticesService],
  exports: [NotificationsService, StaffAlertsService, PersonalNoticesService],
})
export class NotificationsModule {}
