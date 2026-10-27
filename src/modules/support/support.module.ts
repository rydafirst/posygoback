import { Module } from "@nestjs/common";

import { SupportCasesRepository } from "./support-cases.repository";
import { SupportCasesService } from "./support-cases.service";
import { AdminSupportController, PublicSupportController, SupportController } from "./support.controllers";

@Module({ controllers: [PublicSupportController, SupportController, AdminSupportController], providers: [SupportCasesService, SupportCasesRepository] })
export class SupportModule {}
