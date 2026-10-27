import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";

import { RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { PrismaService } from "../../database/prisma.service";
import type { EmailLogView } from "../../shared";

const SHOWN = 100;
const recipient = new ZodValidationPipe(z.string().trim().toLowerCase().max(254).optional());

@Controller({ path: "admin/emails", version: "1" })
export class EmailLogController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission("support.read")
  @Get()
  async list(@Query("to", recipient) to: string | undefined): Promise<EmailLogView[]> {
    const rows = await this.prisma.emailLogEntry.findMany({ where: to ? { toAddress: { contains: to } } : {}, orderBy: { createdAt: "desc" }, take: SHOWN });
    return rows.map((row) => ({ id: row.id, to: row.toAddress, kind: row.kind, subject: row.subject, status: row.status, error: row.error, sentAt: row.createdAt.toISOString() }));
  }
}
