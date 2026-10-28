import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import type { AssistantOutcome } from "../../generated/prisma/client";
import { AttemptLimiterService } from "../../infrastructure/rate-limit/attempt-limiter.service";
import { type AskAssistant, type AssistantAnswerView, type PublicPriceListView, scrubSensitive } from "../../shared";
import { PublicPricesService } from "../finance/fees/public-prices.service";
import { AccountSummaryService } from "./account-summary.service";
import { ANSWER_MODEL, type AnswerModel, type AnswerTurn } from "./answer-model.port";
import { buildSystemPrompt, readReply } from "./assistant-prompt";
import { KnowledgePackService } from "./knowledge-pack.service";

const PER_IP = { name: "assistant-ip", limit: 30, windowSeconds: 60 * 60 };
const PER_USER = { name: "assistant-user", limit: 60, windowSeconds: 24 * 60 * 60 };
const MAX_TOKENS = 400;
const HANDOFF: AssistantAnswerView = { answer: null, handoff: true };

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function conversation(history: AskAssistant["history"], question: string): AnswerTurn[] {
  const turns: AnswerTurn[] = [];
  for (const turn of [
    ...history.map((entry) => ({ role: entry.from === "person" ? ("user" as const) : ("assistant" as const), content: scrubSensitive(entry.text) })),
    { role: "user" as const, content: question },
  ]) {
    const last = turns.at(-1);
    if (!last && turn.role === "assistant") {
      continue;
    }
    if (last?.role === turn.role) {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      turns.push({ ...turn });
    }
  }
  return turns;
}

@Injectable()
export class AssistantAnswersService {
  private readonly logger = new Logger(AssistantAnswersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AttemptLimiterService,
    private readonly knowledge: KnowledgePackService,
    private readonly accounts: AccountSummaryService,
    private readonly prices: PublicPricesService,
    @Inject(ANSWER_MODEL) private readonly model: AnswerModel,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.model.enabled;
  }

  async ask(input: AskAssistant, meta: RequestMeta, principal: AuthPrincipal | null): Promise<AssistantAnswerView> {
    if (!this.model.enabled) {
      throw Errors.notFound();
    }
    await this.limiter.consume(PER_IP, meta.ip);
    if (principal) {
      await this.limiter.consume(PER_USER, principal.userId);
    }
    const question = scrubSensitive(input.question);
    const record = (outcome: AssistantOutcome, tokens = { inputTokens: 0, outputTokens: 0 }) =>
      this.prisma.assistantQuestion.create({ data: { userId: principal?.userId ?? null, page: input.page, question, outcome, ...tokens } });
    const usedToday = await this.prisma.assistantQuestion.count({ where: { createdAt: { gte: startOfToday() }, outcome: { not: "LIMITED" } } });
    if (usedToday >= this.config.ASSISTANT_DAILY_ANSWERS) {
      await record("LIMITED");
      return HANDOFF;
    }
    const [pack, account, prices] = await Promise.all([this.knowledge.current(), this.accounts.describe(principal), this.priceLists(principal)]);
    try {
      const reply = await this.model.answer({ system: buildSystemPrompt({ pack, path: input.page, account, prices }), turns: conversation(input.history, question), maxTokens: MAX_TOKENS });
      const result = readReply(reply.text);
      await record(result.handoff ? "UNSURE" : "ANSWERED", { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens });
      return result;
    } catch (error) {
      this.logger.warn(`Couldn't answer a question: ${error instanceof Error ? error.message : String(error)}`);
      await record("FAILED");
      return HANDOFF;
    }
  }

  private async priceLists(principal: AuthPrincipal | null): Promise<PublicPriceListView[]> {
    const codes = principal?.vendorId
      ? (await this.prisma.vendorCountry.findMany({ where: { vendorId: principal.vendorId }, select: { countryCode: true }, orderBy: { countryCode: "asc" } })).map((entry) => entry.countryCode)
      : principal?.countryCode
        ? [principal.countryCode]
        : (await this.prisma.country.findMany({ where: { status: "LIVE" }, select: { code: true }, orderBy: { code: "asc" } })).map((country) => country.code);
    const lists = await Promise.all(codes.map((code) => this.prices.forCountry(code).catch(() => null)));
    return lists.filter((list): list is PublicPriceListView => list !== null);
  }
}
