export type InboxNotification = {
  id: string; ajo_group_id: string | null; event_type: string; channel: string;
  title: string; body: string; status: string; read_at: string | null; created_at: string;
};
export const notificationUpdateEvent = "ajocircle:notifications-updated";
export function refreshUnreadCount() { window.dispatchEvent(new Event(notificationUpdateEvent)); }

export function notificationAction(notification: InboxNotification): { href: string; label: string } | null {
  const id = notification.ajo_group_id;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const group = `/dashboard/ajos/${id}`;
  if (["CONTRIBUTION_SUBMITTED", "CONTRIBUTION_VERIFIED"].includes(notification.event_type)) {
    return { href: `${group}/contributions`, label: "View contribution history" };
  }
  if (notification.event_type === "PAYOUT_RECORDED") return { href: `${group}/cycles`, label: "View cycle history" };
  return { href: group, label: "View group" };
}
