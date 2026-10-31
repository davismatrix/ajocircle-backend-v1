"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { notificationUpdateEvent } from "@/lib/notifications";

export function NotificationBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let controller: AbortController | null = null;
    let active = true;
    function refresh() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      api<{ count: number }>("/notifications/unread-count", { signal }).then((result) => {
        if (active && !signal.aborted) {
          if (!Number.isSafeInteger(result.count) || result.count < 0) throw new Error("Invalid count");
          setCount(result.count); setUnavailable(false);
        }
      }).catch(() => { if (active && !signal.aborted) setUnavailable(true); });
    }
    function visible() { if (document.visibilityState === "visible") refresh(); }
    refresh();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(notificationUpdateEvent, refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(notificationUpdateEvent, refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname]);
  const label = unavailable ? "Notifications, unread count unavailable" : count === null ? "Notifications" : `Notifications, ${count} unread`;
  return <Link href="/dashboard/notifications" aria-label={label}>Notifications
    <span aria-live="polite" className="notification-count">{unavailable ? <span title="Unread count unavailable">!</span> : count !== null && count > 0 ? <span className="badge">{count > 99 ? "99+" : count}</span> : null}</span>
  </Link>;
}
