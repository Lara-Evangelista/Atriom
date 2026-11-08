type NotificationHandler = (data: Record<string, unknown>) => void;
const handlers = new Set<NotificationHandler>();

export function emitNotificationNavigation(data: Record<string, unknown>) {
  handlers.forEach((handler) => handler(data));
}

export function subscribeNotificationNavigation(handler: NotificationHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}
