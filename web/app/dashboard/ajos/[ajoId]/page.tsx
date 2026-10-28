"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useResource } from "@/hooks/use-resource";
import { AjoGroup, formatAmount, formatDate, frequencyLabels } from "@/lib/ajo";

export default function GroupPage() {
  const { ajoId } = useParams<{ ajoId: string }>();
  const { data: group, error, retry } = useResource<AjoGroup>(`/ajo-groups/${ajoId}`);

  return <>
    <Link className="back-link" href="/dashboard">← My Ajos</Link>
    {error ? <section className="dashboard-card"><h1>Unable to load this group</h1><p role="alert" className="error">{error}</p>
      <button onClick={retry}>Try again</button></section>
      : !group ? <p className="dashboard-card" role="status">Loading your group…</p>
      : <section className="dashboard-card">
        <div className="card-heading"><h1>{group.name}</h1><span className={`badge ${group.status === "ACTIVE" ? "badge-active" : ""}`}>{group.status}</span></div>
        <p className="muted">{group.status === "DRAFT" ? "Your group is in draft. Contributions begin after activation." : "Your savings group overview."}</p>
        <dl className="group-details">
          <div><dt>Contribution per member</dt><dd>{formatAmount(group.contribution_amount, group.currency)}</dd></div>
          <div><dt>Frequency</dt><dd>{frequencyLabels[group.frequency]}</dd></div>
          <div><dt>Start date</dt><dd>{formatDate(group.start_date)}</dd></div>
          <div><dt>Payout type</dt><dd>Rotational</dd></div>
        </dl>
      </section>}
  </>;
}
