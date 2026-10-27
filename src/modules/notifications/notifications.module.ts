import { Global, Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller";
import { NotificationsJobs } from "./notifications.jobs";
import { NotificationsService } from "./notifications.service";
import { PersonalNoticesService } from "./personal-notices.service";
import { StaffAlertsService } from "./staff-alerts.service";

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsJobs, StaffAlertsService, PersonalNoticesService],
  exports: [NotificationsService, StaffAlertsService, PersonalNoticesService],
})
export class NotificationsModule {}
