import { Module } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { FinanceModule } from "../finance/finance.module";
import { AccountSummaryService } from "./account-summary.service";
import { ANSWER_MODEL } from "./answer-model.port";
import { answerModelFor } from "./answer-models";
import { AssistantAnswersService } from "./assistant-answers.service";
import { AssistantUsageService } from "./assistant-usage.service";
import { AdminAssistantController, AssistantController, PublicAssistantController } from "./assistant.controllers";
import { fetchKnowledge, KNOWLEDGE_FETCH, KnowledgePackService } from "./knowledge-pack.service";

@Module({
  imports: [FinanceModule],
  controllers: [PublicAssistantController, AssistantController, AdminAssistantController],
  providers: [
    AssistantAnswersService,
    AssistantUsageService,
    AccountSummaryService,
    KnowledgePackService,
    { provide: ANSWER_MODEL, inject: [APP_CONFIG], useFactory: (config: AppConfig) => answerModelFor(config) },
    { provide: KNOWLEDGE_FETCH, useValue: fetchKnowledge },
  ],
})
export class AssistantModule {}
