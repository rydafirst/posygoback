export const LOCKOUT_THRESHOLD = 5;
const LOCK_MINUTES = [1, 5, 15, 60] as const;

export function lockMinutesAfter(failedCount: number): number | null {
  if (failedCount < LOCKOUT_THRESHOLD) {
    return null;
  }
  const index = Math.min(failedCount - LOCKOUT_THRESHOLD, LOCK_MINUTES.length - 1);
  return LOCK_MINUTES[index]!;
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return Boolean(lockedUntil && lockedUntil > now);
}
