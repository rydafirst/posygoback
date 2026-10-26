import { Global, Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller";
import { NotificationsJobs } from "./notifications.jobs";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService, NotificationsJobs], exports: [NotificationsService] })
export class NotificationsModule {}
