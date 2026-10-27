import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import type { AssistantQuestionView, AssistantUsageView } from "../../shared";

const SHOWN = 100;

@Injectable()
export class AssistantUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async gaps(): Promise<AssistantQuestionView[]> {
    const rows = await this.prisma.assistantQuestion.findMany({ where: { outcome: { not: "ANSWERED" } }, orderBy: { createdAt: "desc" }, take: SHOWN });
    return rows.map((row) => ({ id: row.id, page: row.page, question: row.question, outcome: row.outcome, signedIn: row.userId !== null, createdAt: row.createdAt.toISOString() }));
  }

  async usage(days: number): Promise<AssistantUsageView> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [byOutcome, tokens] = await Promise.all([
      this.prisma.assistantQuestion.groupBy({ by: ["outcome"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.assistantQuestion.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
    ]);
    const count = (outcome: string) => byOutcome.find((group) => group.outcome === outcome)?._count._all ?? 0;
    return {
      since: since.toISOString(),
      questions: byOutcome.reduce((total, group) => total + group._count._all, 0),
      answered: count("ANSWERED"),
      unsure: count("UNSURE"),
      inputTokens: tokens._sum.inputTokens ?? 0,
      outputTokens: tokens._sum.outputTokens ?? 0,
    };
  }
}
