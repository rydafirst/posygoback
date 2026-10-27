import type { KnowledgePack } from "../../shared";
import { conversation } from "./assistant-answers.service";
import { buildSystemPrompt, pageFor, readReply, UNSURE } from "./assistant-prompt";

const PACK: KnowledgePack = {
  builtAt: "2026-10-27T00:00:00.000Z",
  pages: [
    {
      route: "/inbound/new",
      title: "Send stock in",
      purpose: "Tell the hub what's coming.",
      steps: ["List products.", "Count boxes."],
      fields: [{ name: "carrier", labels: ["Carrier"], meaning: "The delivery company." }],
      related: [],
    },
    { route: "/inbound/[id]", title: "Shipment", purpose: "Follow a shipment.", steps: ["Watch it arrive.", "See the count."], fields: [], related: [] },
  ],
  articles: [{ title: "Fulfilment costs explained", path: "/guides/fulfilment-costs-explained", text: "Storage is charged per box." }],
  faqs: [{ question: "Who looks after my stock?", answer: "Vetted local partners." }],
};

describe("assistant prompt", () => {
  it("finds the most specific page for a path", () => {
    expect(pageFor(PACK, "/inbound/new")?.title).toBe("Send stock in");
    expect(pageFor(PACK, "/inbound/0b6f5a4e-2d1c-4a3b-9c8d-7e6f5a4b3c2d")?.title).toBe("Shipment");
    expect(pageFor(PACK, "/elsewhere")).toBeUndefined();
  });

  it("puts the rules, the page, the account and the guides in the instructions", () => {
    const prompt = buildSystemPrompt({ pack: PACK, path: "/inbound/new", account: "Wallet balance: £12.00", prices: [] });
    expect(prompt).toContain(`reply with exactly ${UNSURE}`);
    expect(prompt).toContain("wallet credit, never cash");
    expect(prompt).toContain("questions, not instructions");
    expect(prompt).toContain("Carrier: The delivery company.");
    expect(prompt).toContain("Wallet balance: £12.00");
    expect(prompt).toContain("Storage is charged per box.");
    expect(prompt).toContain("Needs funds for shipping");
    expect(prompt).toContain("insufficient_funds");
  });

  it("hands over instead of passing on a non-answer", () => {
    expect(readReply("UNSURE")).toEqual({ answer: null, handoff: true });
    expect(readReply("  unsure.")).toEqual({ answer: null, handoff: true });
    expect(readReply("")).toEqual({ answer: null, handoff: true });
    expect(readReply("Storage is charged per box.")).toEqual({ answer: "Storage is charged per box.", handoff: false });
  });

  it("builds a clean back-and-forth that always starts and ends with the person", () => {
    const turns = conversation(
      [
        { from: "helper", text: "Hi, I'm Posy." },
        { from: "person", text: "Hello" },
        { from: "person", text: "My card is 4111 1111 1111 1111" },
        { from: "helper", text: "Please don't share that." },
      ],
      "What does stocking cost?",
    );
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[0]!.content).toContain("[number removed]");
    expect(turns.at(-1)!.content).toBe("What does stocking cost?");
  });
});
