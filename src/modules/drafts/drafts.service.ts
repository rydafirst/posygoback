import { Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { DRAFT_KEEP_DAYS, DRAFT_LIMIT_PER_USER, type DraftResult, type DraftView } from "../../shared";

const KEEP_MS = DRAFT_KEEP_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string, formKey: string): Promise<DraftResult> {
    const found = await this.prisma.formDraft.findUnique({ where: { userId_formKey: { userId, formKey } } });
    if (!found) {
      return { draft: null };
    }
    if (this.isExpired(found.updatedAt)) {
      await this.remove(userId, formKey);
      return { draft: null };
    }
    return { draft: this.toView(found) };
  }

  async save(userId: string, formKey: string, data: Record<string, unknown>): Promise<DraftView> {
    const exists = await this.prisma.formDraft.count({ where: { userId, formKey } });
    if (!exists && (await this.prisma.formDraft.count({ where: { userId } })) >= DRAFT_LIMIT_PER_USER) {
      throw Errors.invalidTransition("You have too many drafts saved. Finish or discard some first.");
    }
    const json = data as Prisma.InputJsonObject;
    const saved = await this.prisma.formDraft.upsert({
      where: { userId_formKey: { userId, formKey } },
      create: { userId, formKey, data: json },
      update: { data: json, updatedAt: new Date() },
    });
    return this.toView(saved);
  }

  async remove(userId: string, formKey: string): Promise<void> {
    await this.prisma.formDraft.deleteMany({ where: { userId, formKey } });
  }

  async removeExpired(now = new Date()): Promise<number> {
    const removed = await this.prisma.formDraft.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - KEEP_MS) } } });
    return removed.count;
  }

  private isExpired(updatedAt: Date): boolean {
    return Date.now() - updatedAt.getTime() > KEEP_MS;
  }

  private toView(row: { formKey: string; data: Prisma.JsonValue; updatedAt: Date }): DraftView {
    return { key: row.formKey, data: row.data as Record<string, unknown>, updatedAt: row.updatedAt.toISOString() };
  }
}
