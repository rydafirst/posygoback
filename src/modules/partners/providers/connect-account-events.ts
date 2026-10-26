import { Injectable, Logger } from "@nestjs/common";

type Listener = (providerAccountId: string) => Promise<void>;

@Injectable()
export class ConnectAccountEvents {
  private readonly logger = new Logger(ConnectAccountEvents.name);
  private readonly listeners: Listener[] = [];

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  async publish(providerAccountId: string): Promise<void> {
    for (const listener of this.listeners) {
      await listener(providerAccountId).catch((error: unknown) => this.logger.error(`Payout account update failed: ${String(error)}`));
    }
  }
}
