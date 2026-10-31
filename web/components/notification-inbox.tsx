"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";
import { InboxNotification, notificationAction, refreshUnreadCount } from "@/lib/notifications";

const pageSize = 25;

export function NotificationInbox() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawPage = search.get("page") ?? "1";
  const page = Number(rawPage);
  const rawUnread = search.get("unread_only") ?? "false";
  const unreadOnly = rawUnread === "true";
  const invalid = !/^[1-9][0-9]*$/.test(rawPage) || !Number.isSafeInteger(page * pageSize) || !["true", "false"].includes(rawUnread);
  function href(changes: Record<string, string>) {
    const query = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) query.set(key, value);
    return `${pathname}?${query}`;
  }
  return <section className="dashboard-card">
    <h1>Notifications</h1>
    <p className="muted">Your group updates, contribution records, and payout notifications.</p>
    {invalid ? <><p className="error" role="alert">The inbox URL contains an invalid page or filter.</p><Link href={pathname}>Reset inbox filters</Link></>
      : <InboxItems page={page} unreadOnly={unreadOnly} href={href} change={(value) => router.push(href({ unread_only: value, page: "1" }), { scroll: false })} />}
  </section>;
}

function InboxItems({ page, unreadOnly, href, change }: { page: number; unreadOnly: boolean; href: (changes: Record<string, string>) => string; change: (value: string) => void }) {
  const router = useRouter();
  const { data, error, retry, refresh } = useResource<InboxNotification[]>(`/notifications?limit=${pageSize + 1}&offset=${(page - 1) * pageSize}&unread_only=${unreadOnly}`);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  function refreshInbox() { refresh(); refreshUnreadCount(); }
  async function markRead(notification: InboxNotification) {
    if (inFlight.current || notification.read_at || readIds.has(notification.id)) return;
    inFlight.current = true; setBusy(notification.id); setActionError(null); setMessage(null);
    try {
      const saved = await api<InboxNotification>(`/notifications/${notification.id}/read`, { method: "POST" });
      if (!saved.read_at) throw new Error("Read status not confirmed");
      setReadIds((previous) => new Set(previous).add(notification.id));
      setMessage(`Marked “${notification.title}” as read.`);
      refreshInbox();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        const next = window.location.pathname + window.location.search;
        router.replace(`/login?next=${encodeURIComponent(next)}`); return;
      }
      setActionError(caught instanceof ApiError && caught.status < 500
        ? caught.message
        : "Unable to confirm the read status. The inbox has been refreshed; you can safely retry any item still unread.");
      refreshInbox();
    } finally { inFlight.current = false; setBusy(null); }
  }
  const visible = data?.slice(0, pageSize).filter((item) => !unreadOnly || !readIds.has(item.id));
  return <>
    <div className="inbox-controls">
      <label>Show notifications<select value={String(unreadOnly)} disabled={Boolean(busy)} onChange={(event) => change(event.target.value)}>
        <option value="false">All notifications</option><option value="true">Unread only</option>
      </select></label>
      <button type="button" className="secondary" disabled={Boolean(busy)} onClick={refreshInbox}>Refresh notifications</button>
    </div>
    {actionError && <p role="alert" className="error notice">{actionError}</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {error ? <><p className="error" role="alert">{error}</p><button onClick={() => { retry(); refreshUnreadCount(); }}>Retry notifications</button></>
      : !data ? <p role="status">Loading notifications…</p>
      : <>
        <p className="muted">Page {page} · Newest first</p>
        {!visible?.length ? <p>{page > 1 ? "No notifications on this page." : unreadOnly ? "You have no unread notifications." : "No notifications yet."}</p>
          : <ul className="notification-list">{visible.map((notification) => {
            const read = Boolean(notification.read_at) || readIds.has(notification.id);
            const action = notificationAction(notification);
            return <li key={notification.id}><article className={read ? "notification-card" : "notification-card notification-unread"} aria-label={notification.title}>
              <div className="card-heading"><h2>{notification.title}</h2><span className={`badge ${read ? "" : "badge-active"}`}>{read ? "Read" : "Unread"}</span></div>
              <p>{notification.body}</p>
              <time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
              <div className="notification-actions">
                {action && <Link href={action.href}>{action.label}</Link>}
                {!read && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => markRead(notification)} aria-label={`Mark ${notification.title} as read`}>{busy === notification.id ? "Marking as read…" : "Mark as read"}</button>}
              </div>
            </article></li>;
          })}</ul>}
        <nav className="pagination" aria-label="Inbox pagination">
          {page > 1 && !busy ? <Link href={href({ page: String(page - 1) })} scroll={false}>Previous notifications</Link> : <button disabled>Previous notifications</button>}
          {data.length > pageSize && !busy ? <Link href={href({ page: String(page + 1) })} scroll={false}>Next notifications</Link> : <button disabled>Next notifications</button>}
          {page > 1 && visible?.length === 0 && <Link href={href({ page: "1" })} scroll={false}>Return to first inbox page</Link>}
        </nav>
      </>}
  </>;
}
