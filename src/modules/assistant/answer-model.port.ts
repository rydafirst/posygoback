export interface AnswerTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AnswerRequest {
  system: string;
  turns: AnswerTurn[];
  maxTokens: number;
}

export interface ModelAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AnswerModel {
  readonly enabled: boolean;
  answer(request: AnswerRequest): Promise<ModelAnswer>;
}

export const ANSWER_MODEL = Symbol("ANSWER_MODEL");
