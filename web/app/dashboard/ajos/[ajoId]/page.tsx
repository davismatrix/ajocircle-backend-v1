"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useResource } from "@/hooks/use-resource";
import { api, ApiError } from "@/lib/api";
import { useCurrentUser } from "@/components/current-user";
import { AjoGroup, formatAmount, formatDate, frequencyLabels } from "@/lib/ajo";

export default function GroupPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const { ajoId } = useParams<{ ajoId: string }>();
  const { data: group, error, retry } = useResource<AjoGroup>(`/ajo-groups/${ajoId}`);

  async function cancelGroup() {
    if (!window.confirm("Cancel this draft group? It cannot be activated afterwards. Group records will be kept.")) return;
    setCancelling(true); setCancelError(null);
    try { await api(`/ajo-groups/${ajoId}/cancel`, { method: "POST" }); retry(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setCancelError(error instanceof ApiError ? error.message : "Unable to cancel the group. Please try again.");
    } finally { setCancelling(false); }
  }

  return <>
    <Link className="back-link" href="/dashboard">← My Ajos</Link>
    {error ? <section className="dashboard-card"><h1>Unable to load this group</h1><p role="alert" className="error">{error}</p>
      <button onClick={retry}>Try again</button></section>
      : !group ? <p className="dashboard-card" role="status">Loading your group…</p>
      : <section className="dashboard-card">
        <div className="card-heading"><h1>{group.name}</h1><span className={`badge ${group.status === "ACTIVE" ? "badge-active" : ""}`}>{group.status}</span></div>
        <p className="muted">{group.status === "DRAFT" ? "Your group is in draft. Contributions begin after activation." : group.status === "CANCELLED" ? "This group has been cancelled. Its records are preserved." : "Your savings group overview."}</p>
        <p className="group-description">{group.description || "No description provided."}</p>
        <dl className="group-details">
          <div><dt>Contribution per member</dt><dd>{formatAmount(group.contribution_amount, group.currency)}</dd></div>
          <div><dt>Frequency</dt><dd>{frequencyLabels[group.frequency]}</dd></div>
          <div><dt>Start date</dt><dd>{formatDate(group.start_date)}</dd></div>
          <div><dt>Payout type</dt><dd>Rotational</dd></div>
          <div><dt>Grace period</dt><dd>{group.grace_period_days} days after cycle start</dd></div>
          <div><dt>Late fee</dt><dd>{formatAmount(group.late_fee, group.currency)}</dd></div>
        </dl>
        {group.status === "DRAFT" && group.created_by === user.id && <div className="draft-actions">
          <Link className="button-link" href={`/dashboard/ajos/${group.id}/edit`}>Edit draft</Link>
          <button className="secondary" disabled={cancelling} onClick={cancelGroup}>{cancelling ? "Cancelling…" : "Cancel group"}</button>
        </div>}
        {cancelError && <p className="error notice" role="alert">{cancelError}</p>}
      </section>}
  </>;
}
