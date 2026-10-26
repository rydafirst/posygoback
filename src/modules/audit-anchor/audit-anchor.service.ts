import { Inject, Injectable } from "@nestjs/common";

import { isoDate } from "../../common/dates";
import { PrismaService } from "../../database/prisma.service";
import { OBJECT_STORAGE, type ObjectStorage } from "../files/storage/object-storage.port";

export interface AuditAnchor {
  date: string;
  sequence: string;
  hash: string;
  anchoredAt: string;
}

export function anchorKey(date: string): string {
  return `audit-anchors/${date}.json`;
}

@Injectable()
export class AuditAnchorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async anchor(now: Date = new Date()): Promise<AuditAnchor | null> {
    const latest = await this.prisma.auditLogEntry.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true, hash: true } });
    if (!latest) {
      return null;
    }
    const date = isoDate(now);
    if (await this.storage.head(anchorKey(date))) {
      return null;
    }
    const anchor: AuditAnchor = { date, sequence: latest.sequence.toString(), hash: latest.hash, anchoredAt: now.toISOString() };
    await this.storage.writeOnce(anchorKey(date), Buffer.from(JSON.stringify(anchor)), "application/json");
    return anchor;
  }
}
