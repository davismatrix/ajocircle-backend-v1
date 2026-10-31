import { Suspense } from "react";
import { NotificationInbox } from "@/components/notification-inbox";

export default function NotificationsPage() {
  return <Suspense fallback={<p role="status">Loading notifications…</p>}><NotificationInbox /></Suspense>;
}
