export type NotificationRoute =
  | { screen: "notifications" }
  | { screen: "notification-detail"; notificationId: string }
  | { screen: "settle"; groupId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSchemaVersion1(data: Record<string, unknown>): boolean {
  return data.schema_version === 1 || data.schema_version === "1";
}

export function resolveNotificationRoute(data: Record<string, unknown>): NotificationRoute | null {
  if (
    isSchemaVersion1(data) &&
    data.route === "notification-detail" &&
    typeof data.notification_id === "string" &&
    UUID.test(data.notification_id)
  ) {
    return { screen: "notification-detail", notificationId: data.notification_id };
  }
  if (isSchemaVersion1(data) && data.route === "notifications") {
    return { screen: "notifications" };
  }
  if (
    isSchemaVersion1(data) &&
    data.route === "settle" &&
    typeof data.group_id === "string" &&
    UUID.test(data.group_id)
  ) {
    return { screen: "settle", groupId: data.group_id };
  }
  return null;
}
