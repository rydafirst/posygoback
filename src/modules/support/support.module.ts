import { Module } from "@nestjs/common";

import { EmailLogController } from "./email-log.controller";
import { SupportCasesRepository } from "./support-cases.repository";
import { SupportCasesService } from "./support-cases.service";
import { AdminSupportController, PublicSupportController, SupportController } from "./support.controllers";

@Module({ controllers: [PublicSupportController, SupportController, AdminSupportController, EmailLogController], providers: [SupportCasesService, SupportCasesRepository], exports: [SupportCasesService] })
export class SupportModule {}
