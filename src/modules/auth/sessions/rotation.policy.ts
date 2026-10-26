export type RotationDecision = "ROTATE" | "SUPERSEDED" | "REUSE_DETECTED" | "INVALID";

export interface RotatableSession {
  refreshTokenHash: string;
  previousTokenHashes: string[];
  revokedAt: Date | null;
  expiresAt: Date;
  lastUsedAt: Date;
}

export interface HashComparer {
  matches(expectedHex: string, actualHex: string): boolean;
}

export const CONCURRENT_REFRESH_GRACE_MS = 15_000;

export function decideRotation(session: RotatableSession, presentedHash: string, now: Date, comparer: HashComparer): RotationDecision {
  if (session.revokedAt || session.expiresAt <= now) {
    return "INVALID";
  }
  if (comparer.matches(session.refreshTokenHash, presentedHash)) {
    return "ROTATE";
  }
  const previousIndex = session.previousTokenHashes.findIndex((hash) => comparer.matches(hash, presentedHash));
  if (previousIndex === -1) {
    return "INVALID";
  }
  const isMostRecent = previousIndex === session.previousTokenHashes.length - 1;
  const withinGrace = now.getTime() - session.lastUsedAt.getTime() < CONCURRENT_REFRESH_GRACE_MS;
  return isMostRecent && withinGrace ? "SUPERSEDED" : "REUSE_DETECTED";
}
