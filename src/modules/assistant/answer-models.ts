import type { AppConfig } from "../../config/config.schema";
import type { AnswerModel, AnswerRequest, ModelAnswer } from "./answer-model.port";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 20_000;

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicAnswerModel implements AnswerModel {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async answer(request: AnswerRequest): Promise<ModelAnswer> {
    const response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({ model: this.model, max_tokens: request.maxTokens, system: request.system, messages: request.turns }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`The answer service replied ${response.status}`);
    }
    const body = (await response.json()) as MessagesResponse;
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
  }
}

export class NoAnswerModel implements AnswerModel {
  readonly enabled = false;

  answer(): Promise<ModelAnswer> {
    return Promise.reject(new Error("Answers aren't switched on"));
  }
}

export function answerModelFor(config: AppConfig): AnswerModel {
  return config.ASSISTANT_AI === "anthropic" ? new AnthropicAnswerModel(config.ANTHROPIC_API_KEY, config.ASSISTANT_AI_MODEL) : new NoAnswerModel();
}
