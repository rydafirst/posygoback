import { AnthropicAnswerModel, NoAnswerModel } from "./answer-models";

describe("answer models", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends the instructions and the conversation to Claude, and reads back the text and usage", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: [{ type: "text", text: " Storage is per box. " }], usage: { input_tokens: 900, output_tokens: 12 } }) });
    global.fetch = fetchMock;
    const model = new AnthropicAnswerModel("sk-ant-test-key-0123456789", "claude-haiku-5-5");
    const answer = await model.answer({ system: "Rules", turns: [{ role: "user", content: "How is storage charged?" }], maxTokens: 400 });
    expect(answer).toEqual({ text: "Storage is per box.", inputTokens: 900, outputTokens: 12 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant-test-key-0123456789", "anthropic-version": "2023-06-01" });
    expect(JSON.parse(init.body as string)).toEqual({ model: "claude-haiku-5-5", max_tokens: 400, system: "Rules", messages: [{ role: "user", content: "How is storage charged?" }] });
  });

  it("fails loudly on an error reply so the helper hands over", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 529 });
    await expect(new AnthropicAnswerModel("sk-ant-test-key-0123456789", "claude-haiku-5-5").answer({ system: "", turns: [], maxTokens: 10 })).rejects.toThrow("529");
  });

  it("stays off until it's switched on", async () => {
    expect(new NoAnswerModel().enabled).toBe(false);
    await expect(new NoAnswerModel().answer()).rejects.toThrow();
  });
});
