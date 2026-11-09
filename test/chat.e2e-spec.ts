import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { io, type Socket } from "socket.io-client";

import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { CHAT_NAMESPACE, LIVE_EVENTS, type ChatMessageView, type ChatPageView, type ChatSendAck, type ChatThreadView } from "../src/shared";
import { createStaff, flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";

const SETTLE_MS = 150;

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe("chat between sellers, partners and the team", () => {
  let test: TestApp;
  let url: string;
  let seller: string;
  let otherSeller: string;
  let admin: string;
  let finance: string;
  let threadId: string;
  const sockets: Socket[] = [];

  const connect = async (token: string | undefined): Promise<Socket> => {
    const socket = io(`${url}${CHAT_NAMESPACE}`, { auth: token ? { token } : {}, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (error) => reject(error));
    });
    return socket;
  };

  const received = (socket: Socket, event = "message") => {
    const events: ChatMessageView[] = [];
    socket.on(event, (payload: ChatMessageView) => events.push(payload));
    return events;
  };

  const send = (socket: Socket, body: string, extra: { clientId?: string; replyToId?: string } = {}): Promise<ChatSendAck> =>
    socket.timeout(5000).emitWithAck("send", { threadId, clientId: extra.clientId ?? randomUUID(), body, ...(extra.replyToId ? { replyToId: extra.replyToId } : {}) });

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    await test.app.listen(0);
    url = `http://127.0.0.1:${(test.app.getHttpServer().address() as AddressInfo).port}`;
    seller = (await signUpAndVerify(test, "owner@chatty.test")).accessToken;
    otherSeller = (await signUpAndVerify(test, "owner@quiet.test")).accessToken;
    admin = await createStaff(test, "admin@gfn.test", "ADMIN");
    finance = await createStaff(test, "finance@gfn.test", "FINANCE_ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await test.app.close();
  });

  it("gives each seller one conversation, hidden from the team until they write", async () => {
    const page = (await test.http().get("/v1/chat/thread").set(as(seller)).expect(200)).body as ChatPageView;
    threadId = page.thread.id;
    expect(page).toMatchObject({ thread: { reference: expect.stringMatching(/^CHAT-/), account: { kind: "VENDOR", name: "Acme Goods" } }, messages: [], hasMore: false });
    expect((await test.http().get("/v1/chat/thread").set(as(seller)).expect(200)).body.thread.id).toBe(threadId);
    expect((await test.http().get("/v1/chat/threads").set(as(admin)).expect(200)).body).toEqual([]);
  });

  it("refuses sockets without a valid sign-in", async () => {
    await expect(connect(undefined)).rejects.toThrow("unauthorised");
    await expect(connect("not.a.token")).rejects.toThrow("unauthorised");
  });

  it("delivers a seller's message to the team straight away, once, and alerts the team once", async () => {
    const sellerSocket = await connect(seller);
    const teamSocket = await connect(admin);
    const teamSees = received(teamSocket);
    const sellerSees = received(sellerSocket);
    const clientId = randomUUID();

    const first = await send(sellerSocket, "Where is order ord-gb-abc1234? See case-abcd1234 too.", { clientId });
    expect(first).toMatchObject({ ok: true, duplicate: false, message: { side: "CUSTOMER", authorLabel: "Acme Goods", references: ["ORD-GB-ABC1234", "CASE-ABCD1234"] } });
    const again = await send(sellerSocket, "Where is order ord-gb-abc1234? See case-abcd1234 too.", { clientId });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (again.ok && first.ok) {
      expect(again.message.id).toBe(first.message.id);
    }
    await settle();
    expect(teamSees).toHaveLength(1);
    expect(sellerSees).toHaveLength(1);
    expect(test.email.lastTo("admin@gfn.test")?.subject).toBe("Acme Goods sent a message");

    const emailsBefore = test.email.sent.length;
    await send(sellerSocket, "Any update?");
    await settle();
    expect(test.email.sent.length).toBe(emailsBefore);
    const [count] = await query<{ count: string }>("SELECT count(*) FROM chat_messages WHERE thread_id = $1", [threadId]);
    expect(Number(count!.count)).toBe(2);

    const inbox = (await test.http().get("/v1/chat/threads").set(as(admin)).expect(200)).body as ChatThreadView[];
    expect(inbox).toEqual([expect.objectContaining({ id: threadId, waitingSince: expect.any(String), unread: 2, lastMessage: expect.objectContaining({ body: "Any update?" }) })]);
    expect((await test.http().get("/v1/chat/unread").set(as(admin)).expect(200)).body).toEqual({ count: 1 });
  });

  it("lets the team reply to a message, and doesn't email a seller who is online", async () => {
    const sellerSocket = await connect(seller);
    const teamSocket = await connect(admin);
    const sellerSees = received(sellerSocket);
    const page = (await test.http().get(`/v1/chat/threads/${threadId}/messages`).set(as(admin)).expect(200)).body as ChatPageView;
    const question = page.messages[0]!;
    const emailsBefore = test.email.sent.length;

    const reply = await send(teamSocket, "It's out for delivery today.", { replyToId: question.id });
    expect(reply).toMatchObject({ ok: true, message: { side: "TEAM", authorLabel: "admin@gfn.test", replyTo: { id: question.id, side: "CUSTOMER" } } });
    await settle();
    expect(sellerSees).toEqual([expect.objectContaining({ body: "It's out for delivery today.", authorLabel: "Posygo team", replyTo: expect.objectContaining({ id: question.id }) })]);
    expect(test.email.sent.length).toBe(emailsBefore);
    expect((await test.http().get("/v1/chat/threads").set(as(admin)).expect(200)).body[0].waitingSince).toBeNull();
    sockets.forEach((socket) => socket.disconnect());
  });

  it("tells an offline seller once per unread streak, in the app and by email", async () => {
    const reply = (body: string) =>
      test
        .http()
        .post(`/v1/chat/threads/${threadId}/messages`)
        .set(as(admin))
        .send({ clientId: randomUUID(), body })
        .expect(201);
    await settle();
    await reply("We've also refunded the postage.");
    expect(test.email.lastTo("owner@chatty.test")).toMatchObject({ subject: "New message from the Posygo team", action: { url: expect.stringMatching(/\/messages$/) } });
    const feed = (await test.http().get("/v1/notifications").set(as(seller)).expect(200)).body as { items: Array<{ title: string }> };
    expect(feed.items[0]?.title).toBe("New message from the Posygo team");

    const emailsBefore = test.email.sent.length;
    await reply("Anything else we can help with?");
    expect(test.email.sent.length).toBe(emailsBefore);

    await test.http().post(`/v1/chat/threads/${threadId}/read`).set(as(seller)).expect(204);
    expect((await test.http().get("/v1/chat/unread").set(as(seller)).expect(200)).body).toEqual({ count: 0 });
    await reply("One last thing: your next shipment is booked.");
    expect(test.email.sent.length).toBe(emailsBefore + 1);
    expect((await test.http().get("/v1/chat/unread").set(as(seller)).expect(200)).body).toEqual({ count: 1 });
  });

  it("keeps conversations private and replies inside their own conversation", async () => {
    await test.http().get(`/v1/chat/threads/${threadId}/messages`).set(as(otherSeller)).expect(404);
    await test.http().get("/v1/chat/threads").set(as(finance)).expect(404);
    const other = (await test.http().get("/v1/chat/thread").set(as(otherSeller)).expect(200)).body as ChatPageView;
    const [foreign] = await query<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1 LIMIT 1", [threadId]);
    await test
      .http()
      .post(`/v1/chat/threads/${other.thread.id}/messages`)
      .set(as(otherSeller))
      .send({ clientId: randomUUID(), body: "Replying to someone else", replyToId: foreign!.id })
      .expect(400);
    await test.http().post(`/v1/chat/threads/${other.thread.id}/messages`).set(as(otherSeller)).send({ clientId: randomUUID(), body: "   " }).expect(400);
  });

  it("lets a partner chat with the team too", async () => {
    const flow = new PartnerFlow(test);
    const { token } = await flow.apply("lead@partner.test", "Ada Obi");
    const page = (await test.http().get("/v1/chat/thread").set(as(token)).expect(200)).body as ChatPageView;
    expect(page.thread.account).toMatchObject({ kind: "PARTNER", name: "Ada Obi" });
    const partnerSocket = await connect(token);
    const ack = await partnerSocket.timeout(5000).emitWithAck("send", { threadId: page.thread.id, clientId: randomUUID(), body: "Can I store bulky items?" });
    expect(ack).toMatchObject({ ok: true });
    const inbox = (await test.http().get("/v1/chat/threads").set(as(admin)).expect(200)).body as ChatThreadView[];
    expect(inbox[0]).toMatchObject({ account: { kind: "PARTNER" }, waitingSince: expect.any(String) });
  });

  it("tells a seller's open pages when something on their account changes", async () => {
    const sellerSocket = await connect(seller);
    const otherSocket = await connect(otherSeller);
    const sellerHeard = received(sellerSocket, LIVE_EVENTS.accountChanged);
    const otherHeard = received(otherSocket, LIVE_EVENTS.accountChanged);
    const vendorId = (await test.http().get("/v1/auth/me").set(as(seller)).expect(200)).body.vendorId as string;
    await test.app.get(NotificationsService).forVendor(vendorId, { title: "Your business is verified", body: "You can go live now." });
    await settle();
    expect(sellerHeard).toHaveLength(1);
    expect(otherHeard).toHaveLength(0);
  });
});
