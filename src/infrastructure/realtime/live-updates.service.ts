import { Injectable } from "@nestjs/common";
import type { Namespace } from "socket.io";

import { LIVE_EVENTS, LiveRooms } from "../../shared";

export interface LiveAudience {
  vendorId?: string;
  userIds?: readonly string[];
}

const AFTER_COMMIT_MS = 1500;

@Injectable()
export class LiveUpdatesService {
  private namespace: Namespace | null = null;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  accountChanged(audience: LiveAudience, { afterCommit = false }: { afterCommit?: boolean } = {}): void {
    const rooms = [...(audience.vendorId ? [LiveRooms.account(audience.vendorId)] : []), ...(audience.userIds ?? []).map(LiveRooms.user)];
    if (rooms.length === 0) {
      return;
    }
    const emit = () => this.namespace?.to(rooms).emit(LIVE_EVENTS.accountChanged);
    if (afterCommit) {
      setTimeout(emit, AFTER_COMMIT_MS).unref();
      return;
    }
    emit();
  }
}
