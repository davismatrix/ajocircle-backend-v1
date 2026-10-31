"use client";

import Link from "next/link";
import { useResource } from "@/hooks/use-resource";
import { MyAjo, formatAmount, frequencyLabels } from "@/lib/ajo";

export default function DashboardPage() {
  const { data: groups, error, loading, retry } = useResource<MyAjo[]>("/ajo-groups");

  return <>
    <div className="page-heading"><div><h1>My Ajos</h1><p className="muted">Your savings circles, all in one place.</p></div>
      <Link className="button-link" href="/dashboard/ajos/new">Create a group</Link>
    </div>
    {loading && <p className="dashboard-card" role="status">Loading your savings circles…</p>}
    {error && <section className="dashboard-card"><h2>Unable to load your groups</h2>
      <p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button>
    </section>}
    {groups?.length === 0 && <section className="dashboard-card empty-state">
      <h2>Your first circle starts here</h2><p className="muted">You haven’t joined a savings group yet. Create one to start saving together, or ask a group owner for an invitation.</p>
      <p><Link href="/invitations/accept">Join with an invitation</Link></p>
      <Link className="button-link" href="/dashboard/ajos/new">Create your first group</Link>
    </section>}
    {!!groups?.length && <ul className="group-grid" aria-label="Your savings groups">
      {groups.map((group) => <li key={group.id} className="dashboard-card group-card">
        <div className="card-heading"><h2>{group.name}</h2><span className={`badge ${group.status === "ACTIVE" ? "badge-active" : ""}`}>{group.status}</span></div>
        <p className="contribution-amount">{formatAmount(group.contribution_amount, group.currency)}</p>
        <p className="muted">{frequencyLabels[group.frequency]} contribution per member</p>
        <p>Your role: <strong>{group.membership_role.toLowerCase()}</strong></p>
        <Link href={`/dashboard/ajos/${group.id}`}>{group.status === "DRAFT" ? "View draft group" : "View group"} <span aria-hidden="true">→</span><span className="sr-only">: {group.name}</span></Link>
      </li>)}
    </ul>}
  </>;
}
