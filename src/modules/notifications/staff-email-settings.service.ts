import { Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { type AuditActor, AuditService } from "../../infrastructure/audit/audit.service";
import type { EmailAlertSettingView } from "../../shared";
import { EMAILED_BY_DEFAULT, isStaffTopic, STAFF_TOPICS, type StaffTopicKey } from "./staff-topics";

@Injectable()
export class StaffEmailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<EmailAlertSettingView[]> {
    const saved = new Map((await this.prisma.staffEmailSetting.findMany()).map((row) => [row.topic, row.enabled]));
    return (Object.keys(STAFF_TOPICS) as StaffTopicKey[]).map((topic) => ({ topic, label: STAFF_TOPICS[topic].label, enabled: saved.get(topic) ?? EMAILED_BY_DEFAULT.has(topic) }));
  }

  async isEmailed(topic: StaffTopicKey): Promise<boolean> {
    const row = await this.prisma.staffEmailSetting.findUnique({ where: { topic } });
    return row?.enabled ?? EMAILED_BY_DEFAULT.has(topic);
  }

  async set(topic: string, enabled: boolean, actor: AuditActor, meta: RequestMeta): Promise<EmailAlertSettingView[]> {
    if (!isStaffTopic(topic)) {
      throw Errors.notFound();
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.staffEmailSetting.upsert({ where: { topic }, create: { topic, enabled, updatedBy: actor.userId }, update: { enabled, updatedBy: actor.userId, updatedAt: new Date() } });
      await this.audit.record({ actor, action: "staff_email_alert.changed", resourceType: "staff_email_setting", resourceId: topic, after: { enabled }, meta }, tx);
    });
    return this.list();
  }
}
