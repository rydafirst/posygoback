export const LIVE_EVENTS = {
  accountChanged: "account.changed",
} as const;

export const LiveRooms = {
  account: (accountId: string) => `account:${accountId}`,
  user: (userId: string) => `user:${userId}`,
};
