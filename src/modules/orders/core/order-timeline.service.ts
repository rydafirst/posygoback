import { Injectable } from "@nestjs/common";

import type { OrderEventSource, Prisma } from "../../../generated/prisma/client";

export interface TimelineEntry {
  type: string;
  description: string;
  source: OrderEventSource;
  actorId?: string | null;
  location?: string | null;
  dedupeKey?: string;
  occurredAt?: Date;
}

@Injectable()
export class OrderTimelineService {
  async add(tx: Prisma.TransactionClient, orderId: string, entry: TimelineEntry): Promise<void> {
    await tx.orderEvent.create({
      data: {
        orderId,
        type: entry.type,
        description: entry.description.slice(0, 500),
        source: entry.source,
        actorId: entry.actorId ?? null,
        location: entry.location ?? null,
        dedupeKey: entry.dedupeKey ?? null,
        occurredAt: entry.occurredAt ?? new Date(),
      },
    });
  }

  async addOnce(tx: Prisma.TransactionClient, orderId: string, entries: TimelineEntry[]): Promise<number> {
    if (entries.length === 0) {
      return 0;
    }
    const created = await tx.orderEvent.createMany({
      data: entries.map((entry) => ({
        orderId,
        type: entry.type,
        description: entry.description.slice(0, 500),
        source: entry.source,
        actorId: entry.actorId ?? null,
        location: entry.location ?? null,
        dedupeKey: entry.dedupeKey ?? null,
        occurredAt: entry.occurredAt ?? new Date(),
      })),
      skipDuplicates: true,
    });
    return created.count;
  }
}
