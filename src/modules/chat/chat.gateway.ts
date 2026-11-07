import { Logger } from "@nestjs/common";
import { ConnectedSocket, MessageBody, type OnGatewayInit, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { ZodError } from "zod";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { AppException } from "../../common/http/app-exception";
import { AccessTokenService } from "../auth/tokens/access-token.service";
import { SessionService } from "../auth/sessions/session.service";
import { CHAT_EVENTS, CHAT_NAMESPACE, type ChatSendAck, chatSendSchema, chatThreadEventSchema } from "../../shared";
import { ChatEventsService } from "./chat-events.service";
import { ChatService } from "./chat.service";
import { type ChatViewer, chatViewerOf, roomsFor } from "./chat-viewer";

interface ChatSocketData {
  viewer: ChatViewer;
}

type ChatSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, ChatSocketData>;

const UNAUTHORISED = "unauthorised";

function failure(error: unknown): ChatSendAck {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Check the message and try again." };
  }
  return { ok: false, error: error instanceof AppException ? error.message : "We couldn't send that. Try again." };
}

@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway implements OnGatewayInit<Namespace> {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly chat: ChatService,
    private readonly events: ChatEventsService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.events.attach(namespace);
    namespace.use((socket, next) => {
      this.authenticate(socket as ChatSocket)
        .then(() => next())
        .catch(() => next(new Error(UNAUTHORISED)));
    });
  }

  @SubscribeMessage(CHAT_EVENTS.send)
  async send(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown): Promise<ChatSendAck> {
    try {
      const viewer = await this.active(socket);
      const { threadId, ...input } = chatSendSchema.parse(body);
      const result = await this.chat.send(viewer, threadId, input);
      return { ok: true, message: result.message, duplicate: result.duplicate };
    } catch (error) {
      return failure(error);
    }
  }

  @SubscribeMessage(CHAT_EVENTS.read)
  async read(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    return { ok: await this.quietly(async () => this.chat.read(await this.active(socket), chatThreadEventSchema.parse(body).threadId)) };
  }

  @SubscribeMessage(CHAT_EVENTS.typing)
  async typing(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown): Promise<void> {
    await this.quietly(async () => this.chat.typing(socket.data.viewer, chatThreadEventSchema.parse(body).threadId));
  }

  private async authenticate(socket: ChatSocket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    const principal = typeof token === "string" ? await this.tokens.verify(token) : null;
    if (!principal || principal.mfaState === "ENROLMENT_REQUIRED") {
      throw new Error(UNAUTHORISED);
    }
    await this.sessions.assertActive(principal.sessionId, principal.userId);
    const viewer = chatViewerOf(principal);
    socket.data.viewer = viewer;
    await socket.join(roomsFor(viewer));
  }

  private async active(socket: ChatSocket): Promise<ChatViewer> {
    const { principal }: { principal: AuthPrincipal } = socket.data.viewer;
    try {
      await this.sessions.assertActive(principal.sessionId, principal.userId);
    } catch (error) {
      socket.disconnect(true);
      throw error;
    }
    return socket.data.viewer;
  }

  private async quietly(work: () => Promise<void>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error) {
      this.logger.debug(`Chat event ignored: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
