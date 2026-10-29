import { z } from "zod";

export const ASSISTANT_HISTORY_LIMIT = 6;
export const ASSISTANT_SCREEN_LIMITS = { fields: 30, label: 120, value: 200, alerts: 5, alert: 300 } as const;

const screenText = (max: number) => z.string().trim().min(1).max(max);

export const assistantScreenSchema = z.object({
  title: screenText(160).optional(),
  focused: screenText(ASSISTANT_SCREEN_LIMITS.label).optional(),
  fields: z
    .array(z.object({ label: screenText(ASSISTANT_SCREEN_LIMITS.label), value: z.string().trim().max(ASSISTANT_SCREEN_LIMITS.value) }))
    .max(ASSISTANT_SCREEN_LIMITS.fields)
    .default([]),
  alerts: z.array(screenText(ASSISTANT_SCREEN_LIMITS.alert)).max(ASSISTANT_SCREEN_LIMITS.alerts).default([]),
});
export type AssistantScreenInput = z.input<typeof assistantScreenSchema>;
export type AssistantScreen = z.output<typeof assistantScreenSchema>;

export const askAssistantSchema = z.object({
  page: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^\/[^\s?#]*$/, "Use the page path only"),
  question: z.string().trim().min(2).max(500),
  history: z
    .array(z.object({ from: z.enum(["helper", "person"]), text: z.string().trim().min(1).max(1000) }))
    .max(ASSISTANT_HISTORY_LIMIT)
    .default([]),
  screen: assistantScreenSchema.optional(),
});
export type AskAssistantInput = z.input<typeof askAssistantSchema>;
export type AskAssistant = z.output<typeof askAssistantSchema>;

export interface AssistantAnswerView {
  answer: string | null;
  handoff: boolean;
}

export interface AssistantStatusView {
  answers: boolean;
}

export const ASSISTANT_OUTCOMES = ["ANSWERED", "UNSURE", "LIMITED", "FAILED"] as const;
export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[number];

export interface AssistantQuestionView {
  id: string;
  page: string;
  question: string;
  outcome: AssistantOutcome;
  signedIn: boolean;
  createdAt: string;
}

export interface AssistantUsageView {
  since: string;
  questions: number;
  answered: number;
  unsure: number;
  inputTokens: number;
  outputTokens: number;
}

export interface KnowledgeField {
  name: string;
  labels: string[];
  meaning: string;
  example?: string;
  mistakes?: string[];
}

export interface KnowledgePage {
  route: string;
  title: string;
  purpose: string;
  steps: string[];
  fields: KnowledgeField[];
  related: Array<{ href: string; label: string }>;
}

export interface KnowledgeArticle {
  title: string;
  path: string;
  text: string;
}

export interface KnowledgePack {
  builtAt: string;
  pages: KnowledgePage[];
  articles: KnowledgeArticle[];
  faqs: Array<{ question: string; answer: string }>;
}
