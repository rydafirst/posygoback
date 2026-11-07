import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Server, ServerOptions } from "socket.io";

import type { AppConfig } from "../../config/config.schema";

export class RealtimeAdapter extends IoAdapter {
  private readonly connections: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfig,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      serveClient: false,
      cors: { origin: [new URL(this.config.WEB_PUBLIC_URL).origin], credentials: false },
    }) as Server;
    const publisher = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: 2 });
    const subscriber = publisher.duplicate();
    this.connections.push(publisher, subscriber);
    server.adapter(createAdapter(publisher, subscriber));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.connections.splice(0).map((connection) => connection.quit().catch(() => undefined)));
  }
}
