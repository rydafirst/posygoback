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
