import { Module } from "@nestjs/common";

import { AdminStaffController, StaffInvitationsController } from "./staff.controllers";
import { StaffService } from "./staff.service";

@Module({ controllers: [AdminStaffController, StaffInvitationsController], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}
