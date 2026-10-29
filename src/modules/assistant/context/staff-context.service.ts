import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { PLATFORM_NAME } from "../../../common/brand/brand";
import { PrismaService } from "../../../database/prisma.service";
import type { Role } from "../../../shared";
import { DashboardService } from "../../dashboard/dashboard.service";

const ROLE_LABELS: Partial<Record<Role, string>> = {
  SUPER_ADMIN: "super admin",
  ADMIN: "administrator",
  COMPLIANCE: "compliance",
  FINANCE_ADMIN: "finance",
  COUNTRY_OPS: "country operations",
  WAREHOUSE_OPERATOR: "warehouse operator",
};

@Injectable()
export class StaffContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  async describe(principal: AuthPrincipal): Promise<string> {
    const [user, board] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: principal.userId }, select: { email: true, country: { select: { name: true } } } }),
      this.dashboard.view(principal),
    ]);
    const role = ROLE_LABELS[principal.role] ?? principal.role.toLowerCase();
    const waiting = board.attention.map((item) => `- ${item.label}: ${item.count} (${item.href})`);
    const activity = board.activity
      ? `Last 30 days: ${board.activity.newVendors} new sellers, ${board.activity.ordersCreated} orders created, ${board.activity.ordersShipped} shipped, ${board.activity.stockReceived} stock shipments received.`
      : null;
    return [
      `Who you're helping: a ${PLATFORM_NAME} team member working as ${role}${user?.email ? ` (${user.email})` : ""}, covering ${user?.country?.name ?? "every country"}. They help run the platform, so explain things from the team's side: what to check and which page to use. Don't call them by a name; you don't have one.`,
      waiting.length > 0 ? `Waiting for them right now:\n${waiting.join("\n")}` : "Nothing is waiting for them right now.",
      activity,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

