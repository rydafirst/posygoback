import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import { hasPermission, type Role, ROLES, roleScope } from "../../shared";
import { NotificationsService } from "./notifications.service";
import { STAFF_TOPICS, type StaffTopicKey } from "./staff-topics";

export interface StaffAlert {
  countryCode: string | null;
  title: string;
  body: string;
  href?: string;
  exceptUserId?: string;
}

@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async raise(topicKey: StaffTopicKey, alert: StaffAlert): Promise<void> {
    try {
      const recipients = await this.recipients(topicKey, alert);
      await this.notifications.forUsers(recipients, { title: alert.title, body: alert.body, href: alert.href ?? STAFF_TOPICS[topicKey].href });
    } catch (error) {
      this.logger.warn(`Couldn't alert staff about ${topicKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async recipients(topicKey: StaffTopicKey, alert: StaffAlert): Promise<string[]> {
    const permitted = ROLES.filter((role) => roleScope(role) !== "VENDOR" && hasPermission(role, STAFF_TOPICS[topicKey].permission));
    const platformWide = permitted.filter((role) => roleScope(role) === "PLATFORM");
    const countryBound: Role[] = permitted.filter((role) => roleScope(role) !== "PLATFORM");
    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        vendorId: null,
        partnerId: null,
        id: alert.exceptUserId ? { not: alert.exceptUserId } : undefined,
        OR: [{ role: { in: platformWide } }, ...(alert.countryCode ? [{ role: { in: countryBound }, countryCode: alert.countryCode }] : [])],
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
}
