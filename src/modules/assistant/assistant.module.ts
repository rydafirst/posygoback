import { Module } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { DashboardModule } from "../dashboard/dashboard.module";
import { FinanceModule } from "../finance/finance.module";
import { AccountSummaryService } from "./account-summary.service";
import { PartnerContextService } from "./context/partner-context.service";
import { StaffContextService } from "./context/staff-context.service";
import { VendorContextService } from "./context/vendor-context.service";
import { ANSWER_MODEL } from "./answer-model.port";
import { answerModelFor } from "./answer-models";
import { AssistantAnswersService } from "./assistant-answers.service";
import { AssistantUsageService } from "./assistant-usage.service";
import { AdminAssistantController, AssistantController, PublicAssistantController } from "./assistant.controllers";
import { fetchKnowledge, KNOWLEDGE_FETCH, KnowledgePackService } from "./knowledge-pack.service";

@Module({
  imports: [FinanceModule, DashboardModule],
  controllers: [PublicAssistantController, AssistantController, AdminAssistantController],
  providers: [
    AssistantAnswersService,
    AssistantUsageService,
    AccountSummaryService,
    VendorContextService,
    PartnerContextService,
    StaffContextService,
    KnowledgePackService,
    { provide: ANSWER_MODEL, inject: [APP_CONFIG], useFactory: (config: AppConfig) => answerModelFor(config) },
    { provide: KNOWLEDGE_FETCH, useValue: fetchKnowledge },
  ],
})
export class AssistantModule {}
