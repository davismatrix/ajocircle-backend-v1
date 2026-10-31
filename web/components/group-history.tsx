"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useResource } from "@/hooks/use-resource";
import { ContributionHistoryItem, CycleHistoryItem, GroupDashboard, HistoryPage, Member, formatAmount, formatDate } from "@/lib/ajo";

type Kind = "contributions" | "cycles";
const contributionStatuses = ["EXPECTED", "PENDING", "SUBMITTED", "VERIFIED"];
const payoutStatuses = ["PENDING", "PAID"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels: Record<string, string> = { EXPECTED: "Awaiting payment", PENDING: "Pending", SUBMITTED: "Submitted", VERIFIED: "Verified", PAID: "Paid", UPCOMING: "Upcoming" };
function Badge({ status }: { status: string }) {
  return <span className={`badge ${["PAID", "VERIFIED"].includes(status) ? "badge-active" : ""}`}>{labels[status] ?? status.replaceAll("_", " ").toLowerCase()}</span>;
}
function timestamp(value: string | null) { return value ? new Date(value).toLocaleString() : "Not recorded"; }

export function GroupHistory({ kind }: { kind: Kind }) {
  const { ajoId } = useParams<{ ajoId: string }>();
  const { data, error, retry } = useResource<GroupDashboard>(`/ajo-groups/${ajoId}/dashboard`);
  const title = kind === "contributions" ? "Contribution history" : "Cycle history";
  return <>
    <Link className="back-link" href={`/dashboard/ajos/${ajoId}`}>← Group dashboard</Link>
    <section className="dashboard-card">
      <h1>{title}</h1>
      {error ? <><p role="alert" className="error">{error}</p><button onClick={retry}>Try again</button></>
        : !data ? <p role="status">Loading group…</p>
        : <><p className="muted">{data.group.name} · {data.group.currency}</p>
          <nav className="history-navigation" aria-label="Group history">
            <Link aria-current={kind === "contributions" ? "page" : undefined} href={`/dashboard/ajos/${ajoId}/contributions`}>Contribution history</Link>
            <Link aria-current={kind === "cycles" ? "page" : undefined} href={`/dashboard/ajos/${ajoId}/cycles`}>Cycle history</Link>
          </nav>
          <HistoryRecords key={`${ajoId}-${kind}`} kind={kind} dashboard={data} />
        </>}
    </section>
  </>;
}

function MemberFilter({ groupId, selected, change }: { groupId: string; selected: string; change: (value: string) => void }) {
  const { data, error, retry } = useResource<Member[]>(`/ajo-groups/${groupId}/members`);
  return <div><label>Member<select value={selected} onChange={(event) => change(event.target.value)}>
    <option value="">All members</option>
    {selected && !data?.some((item) => item.id === selected) && <option value={selected}>Selected member</option>}
    {data?.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name}</option>)}
  </select></label>
  {error && <><p className="error" role="alert">Unable to load member filters: {error}</p><button type="button" className="secondary" onClick={retry}>Retry member filters</button></>}
  {!data && !error && <p role="status">Loading member filters…</p>}
  </div>;
}

function HistoryRecords({ kind, dashboard }: { kind: Kind; dashboard: GroupDashboard }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pageValue = search.get("page") ?? "1";
  const pageSizeValue = search.get("page_size") ?? "25";
  const page = Number(pageValue);
  const pageSize = Number(pageSizeValue);
  const statusKey = kind === "contributions" ? "status" : "payout_status";
  const status = search.get(statusKey) ?? "";
  const member = kind === "contributions" ? search.get("member_id") ?? "" : "";
  const statuses = kind === "contributions" ? contributionStatuses : payoutStatuses;
  const invalid = !/^[1-9][0-9]*$/.test(pageValue) || !Number.isSafeInteger(page)
    || !/^[1-9][0-9]*$/.test(pageSizeValue) || pageSize > 100
    || Boolean(status && !statuses.includes(status)) || Boolean(member && !uuid.test(member));
  const canReviewAll = ["OWNER", "ADMIN", "TREASURER"].includes(dashboard.membership.role);
  function href(changes: Record<string, string>) {
    const query = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) { if (value) query.set(key, value); else query.delete(key); }
    return `${pathname}${query.size ? `?${query.toString()}` : ""}`;
  }
  function change(key: string, value: string) { router.push(href({ [key]: value, page: "1" }), { scroll: false }); }
  if (invalid) return <div className="history-results"><p role="alert" className="error">The history URL contains an invalid page or filter.</p><Link href={pathname}>Reset history filters</Link></div>;
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status) query.set(statusKey, status);
  if (member) query.set("member_id", member);
  return <>
    {kind === "contributions" && <p className="muted">{canReviewAll ? "View the group’s contributions or filter by member." : "You can view only your own contributions."}</p>}
    <div className="history-filters">
      {kind === "contributions" && canReviewAll && <MemberFilter groupId={dashboard.group.id} selected={member} change={(value) => change("member_id", value)} />}
      <label>{kind === "contributions" ? "Contribution status" : "Payout status"}<select value={status} onChange={(event) => change(statusKey, event.target.value)}>
        <option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}
      </select></label>
      <label>Records per page<select value={pageSizeValue} onChange={(event) => change("page_size", event.target.value)}>
        {![10, 25, 50, 100].includes(pageSize) && <option value={pageSize}>{pageSize}</option>}
        {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <Link href={pathname}>Reset filters</Link>
    </div>
    <HistoryResults kind={kind} dashboard={dashboard} path={`/ajo-groups/${dashboard.group.id}/${kind}/history?${query}`} page={page} href={href} />
  </>;
}

function HistoryResults({ kind, dashboard, path, page, href }: { kind: Kind; dashboard: GroupDashboard; path: string; page: number; href: (changes: Record<string, string>) => string }) {
  const { data, error, retry } = useResource<HistoryPage<ContributionHistoryItem | CycleHistoryItem>>(path);
  const currency = dashboard.group.currency;
  if (error) return <div className="history-results"><p role="alert" className="error">{error}</p><button onClick={retry}>Retry history</button></div>;
  if (!data) return <p className="history-results" role="status">Loading history…</p>;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return <div className="history-results">
    <p role="status">{data.total} record{data.total === 1 ? "" : "s"} · Page {page} of {pages} · Newest first</p>
    {data.items.length === 0 ? <p>{data.total ? "No records on this page." : dashboard.group.status === "DRAFT" ? "No history yet. Schedules and cycles are created when the group is activated." : "No records match these filters."}</p>
      : <ol className="history-list">{data.items.map((item) => "schedule_id" in item ? <li key={item.schedule_id}><article aria-label={`Cycle ${item.cycle_number} contribution for ${item.first_name} ${item.last_name}`}>
        <div className="card-heading"><h2>Cycle {item.cycle_number} · {item.first_name} {item.last_name}</h2><Badge status={item.contribution_status ?? item.schedule_status} /></div>
        <dl className="group-details">
          <div><dt>Due date</dt><dd>{formatDate(item.due_date)}</dd></div>
          <div><dt>Schedule status</dt><dd>{labels[item.schedule_status] ?? item.schedule_status}</dd></div>
          <div><dt>Expected amount</dt><dd>{formatAmount(item.expected_amount, currency)}</dd></div>
          <div><dt>Recorded amount</dt><dd>{item.paid_amount === null ? "Not submitted" : formatAmount(item.paid_amount, currency)}</dd></div>
          <div><dt>Payment method</dt><dd>{item.payment_method ?? "Not recorded"}</dd></div>
          <div><dt>Payment reference</dt><dd>{item.payment_reference ?? "Not recorded"}</dd></div>
          <div><dt>Submitted</dt><dd>{timestamp(item.submitted_at)}</dd></div>
          <div><dt>Verified</dt><dd>{timestamp(item.verified_at)}</dd></div>
        </dl>
      </article></li> : <li key={item.cycle_id}><article aria-label={`Cycle ${item.cycle_number}`}>
        <div className="card-heading"><h2>Cycle {item.cycle_number}</h2><Badge status={item.status} /></div>
        <dl className="group-details">
          <div><dt>Period</dt><dd>{formatDate(item.period_start)} – {formatDate(item.period_end)}</dd></div>
          <div><dt>Recipient</dt><dd>{item.recipient_first_name || item.recipient_last_name ? `${item.recipient_first_name ?? ""} ${item.recipient_last_name ?? ""}`.trim() : "Not assigned"}</dd></div>
          <div><dt>Expected payout</dt><dd>{formatAmount(item.expected_amount, currency)}</dd></div>
          <div><dt>Recorded payout</dt><dd>{item.actual_amount === null ? "Not paid" : formatAmount(item.actual_amount, currency)}</dd></div>
          <div><dt>Payout status</dt><dd>{item.payout_status ? <Badge status={item.payout_status} /> : "Not scheduled"}</dd></div>
          <div><dt>Paid</dt><dd>{timestamp(item.paid_at)}</dd></div>
        </dl>
      </article></li>)}</ol>}
    <nav className="pagination" aria-label="History pagination">
      {page > 1 ? <Link href={href({ page: String(page - 1) })} scroll={false}>Previous page</Link> : <button disabled>Previous page</button>}
      {page < pages ? <Link href={href({ page: String(page + 1) })} scroll={false}>Next page</Link> : <button disabled>Next page</button>}
      {page > pages && <Link href={href({ page: "1" })} scroll={false}>Return to first page</Link>}
    </nav>
  </div>;
}
