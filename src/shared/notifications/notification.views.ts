import { z } from "zod";

export interface NotificationView {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationFeedView {
  items: NotificationView[];
  unread: number;
}

export interface EmailAlertSettingView {
  topic: string;
  label: string;
  enabled: boolean;
}

export const emailAlertSettingSchema = z.object({ enabled: z.boolean() });
export type EmailAlertSettingInput = z.infer<typeof emailAlertSettingSchema>;
