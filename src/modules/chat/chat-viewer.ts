import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import type { Prisma } from "../../generated/prisma/client";
import { type ChatSide, hasPermission, LiveRooms } from "../../shared";
import { reviewerCountryScope } from "../onboarding/scope";

export interface CustomerViewer {
  side: "CUSTOMER";
  principal: AuthPrincipal;
  account: { kind: "VENDOR" | "PARTNER"; id: string };
}

export interface TeamViewer {
  side: "TEAM";
  principal: AuthPrincipal;
  countryCode: string | null;
  canReply: boolean;
}

export type ChatViewer = CustomerViewer | TeamViewer;

export function chatViewerOf(principal: AuthPrincipal): ChatViewer {
  if (principal.vendorId || principal.partnerId) {
    if (!hasPermission(principal.role, "chat.use")) {
      throw Errors.notFound();
    }
    return principal.vendorId
      ? { side: "CUSTOMER", principal, account: { kind: "VENDOR", id: principal.vendorId } }
      : { side: "CUSTOMER", principal, account: { kind: "PARTNER", id: principal.partnerId! } };
  }
  if (!hasPermission(principal.role, "support.read")) {
    throw Errors.notFound();
  }
  return { side: "TEAM", principal, countryCode: reviewerCountryScope(principal), canReply: hasPermission(principal.role, "support.manage") };
}

export function threadScope(viewer: ChatViewer): Prisma.ChatThreadWhereInput {
  if (viewer.side === "CUSTOMER") {
    return viewer.account.kind === "VENDOR" ? { vendorId: viewer.account.id } : { partnerId: viewer.account.id };
  }
  return viewer.countryCode ? { countryCode: viewer.countryCode } : {};
}

export function otherSide(side: ChatSide): ChatSide {
  return side === "CUSTOMER" ? "TEAM" : "CUSTOMER";
}

export const ChatRooms = {
  account: LiveRooms.account,
  team: (countryCode: string | null) => (countryCode ? `team:${countryCode}` : "team"),
};

export function roomsFor(viewer: ChatViewer): string[] {
  const userRoom = LiveRooms.user(viewer.principal.userId);
  return viewer.side === "CUSTOMER" ? [ChatRooms.account(viewer.account.id), userRoom] : [ChatRooms.team(viewer.countryCode), userRoom];
}
