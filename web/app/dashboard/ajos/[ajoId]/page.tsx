"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useResource } from "@/hooks/use-resource";
import { api, ApiError } from "@/lib/api";
import { ActivationPreview, GroupDashboard, formatAmount, formatDate, frequencyLabels, utcToday } from "@/lib/ajo";
import { InviteMember, MemberRoles, SubmitContribution, VerifyContributions } from "@/components/dashboard-actions";

const activityLabels: Record<string, string> = {
  CREATE_AJO: "Group created", UPDATE_AJO: "Group settings updated", CANCEL_AJO: "Group cancelled",
  ADD_MEMBER: "Member added", CREATE_INVITATION: "Invitation created", ACCEPT_INVITATION: "Invitation accepted",
  UPDATE_MEMBER_ROLE: "Member role updated", ACTIVATE_AJO: "Group activated", SUBMIT_CONTRIBUTION: "Contribution submitted",
  VERIFY_CONTRIBUTION: "Contribution verified", MARK_PAYOUT_PAID: "Payout recorded",
};

export default function GroupPage() {
  const router = useRouter();
  const { ajoId } = useParams<{ ajoId: string }>();
  const { data, error, retry, refresh } = useResource<GroupDashboard>(`/ajo-groups/${ajoId}/dashboard`);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ActivationPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  async function reviewActivation() {
    if (busy) return;
    setBusy(true); setActionError(null); setPreview(null);
    try { setPreview(await api<ActivationPreview>(`/ajo-groups/${ajoId}/activation-preview`)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setActionError(error instanceof ApiError ? error.message : "Unable to load activation details. Try again.");
    } finally { setBusy(false); }
  }
  async function changeStatus(action: "activate" | "cancel") {
    if (busy || (action === "activate" && !preview)) return;
    const message = action === "activate"
      ? "Activate this group with the reviewed members and payout order? Membership will be frozen."
      : "Cancel this draft group? It cannot be activated afterwards. Group records will be kept.";
    if (!window.confirm(message)) return;
    setBusy(true); setActionError(null);
    try {
      await api(`/ajo-groups/${ajoId}/${action}`, { method: "POST", ...(action === "activate" ? { body: JSON.stringify({ preview_hash: preview!.preview_hash }) } : {}) });
      setPreview(null); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setPreview(null); refresh();
      setActionError(error instanceof ApiError ? error.message : "Unable to confirm the change. Check the refreshed dashboard before trying again.");
    } finally { setBusy(false); }
  }
  function draftChanged() { setPreview(null); refresh(); }

  const group = data?.group;
  const role = data?.membership.role;
  const canAdmin = role === "OWNER" || role === "ADMIN";
  const canVerify = canAdmin || role === "TREASURER";
  const next = data?.next_contribution;
  const cycle = data?.current_cycle;

  return <>
    <Link className="back-link" href="/dashboard">← My Ajos</Link>
    {notice && <p className="notice" role="status">{notice}</p>}
    {error ? <section className="dashboard-card"><h1>Unable to load this group</h1><p role="alert" className="error">{error}</p>
      <button onClick={retry}>Try again</button></section>
      : !data || !group ? <p className="dashboard-card" role="status">Loading your group…</p>
      : <div className="dashboard-sections">
        <section className="dashboard-card">
          <div className="card-heading"><h1>{group.name}</h1><span className={`badge ${group.status === "ACTIVE" ? "badge-active" : ""}`}>{group.status}</span></div>
          <p className="muted">{group.status === "DRAFT" ? "Your group is in draft. Contributions begin after activation." : group.status === "CANCELLED" ? "This group has been cancelled. Its records are preserved." : "Your savings group overview."}</p>
          <nav className="history-navigation" aria-label="Group records">
            <Link href={`/dashboard/ajos/${group.id}/contributions`}>Contribution history</Link>
            <Link href={`/dashboard/ajos/${group.id}/cycles`}>Cycle history</Link>
          </nav>
          <p className="group-description">{group.description || "No description provided."}</p>
          <dl className="group-details">
            <div><dt>Contribution per member</dt><dd>{formatAmount(group.contribution_amount, group.currency)}</dd></div>
            <div><dt>Frequency</dt><dd>{frequencyLabels[group.frequency] ?? group.frequency}</dd></div>
            <div><dt>Start date</dt><dd>{formatDate(group.start_date)}</dd></div>
            <div><dt>Payout type</dt><dd>Rotational</dd></div>
            <div><dt>Grace period</dt><dd>{group.grace_period_days} days after cycle start</dd></div>
            <div><dt>Late fee</dt><dd>{formatAmount(group.late_fee, group.currency)}</dd></div>
            <div><dt>Your role</dt><dd>{role?.toLowerCase()}</dd></div>
            <div><dt>Your payout position</dt><dd>{data.membership.payout_position == null ? "Not assigned" : `${data.membership.payout_position}${group.status === "DRAFT" ? " (provisional)" : ""}`}</dd></div>
          </dl>
          {group.status === "DRAFT" && <div className="draft-actions">
            {canAdmin && <button disabled={busy} onClick={reviewActivation}>{busy ? "Please wait…" : "Review activation"}</button>}
            {role === "OWNER" && <><Link className="button-link" href={`/dashboard/ajos/${group.id}/edit`}>Edit draft</Link>
              <button className="secondary" disabled={busy} onClick={() => changeStatus("cancel")}>{busy ? "Please wait…" : "Cancel group"}</button></>}
          </div>}
          {preview && group.status === "DRAFT" && <div className="activation-review">
            <h2>Review activation</h2>
            <p>{preview.group.name} · {formatAmount(preview.group.contribution_amount, preview.group.currency)} {frequencyLabels[preview.group.frequency]?.toLowerCase()} · Starts {formatDate(preview.group.start_date)}</p>
            {preview.members.length === 1 && <p>Only one member is currently in this group.</p>}
            <p>Members in payout order:</p>
            <ol>{preview.members.map((member) => <li key={member.member_id}>{member.first_name} {member.last_name} — {member.role.toLowerCase()}</li>)}</ol>
            {preview.pending_invitations > 0 ? <p className="error" role="alert">{preview.pending_invitations} pending invitation(s) must be accepted or cancelled before activation.</p>
              : <p>Membership and payout order will be frozen when you activate.</p>}
            <button disabled={busy || preview.pending_invitations > 0 || preview.members.length === 0} onClick={() => changeStatus("activate")}>Confirm activation</button>
            <button className="secondary" disabled={busy} onClick={reviewActivation}>Refresh review</button>
          </div>}
          {actionError && <p className="error notice" role="alert">{actionError}</p>}
        </section>
        <section className="dashboard-card"><h2>Next contribution</h2>
          {group.status === "DRAFT" ? <p className="muted">A schedule will be created when the group is activated.</p>
            : group.status === "CANCELLED" ? <p className="muted">This group has no contribution schedule.</p>
            : !next ? <p className="muted">You have no outstanding contribution scheduled.</p>
            : <><p><strong>{formatAmount(next.expected_amount, group.currency)}</strong> · Due {formatDate(next.due_date)}</p>
              <p>{next.status === "SUBMITTED" ? "Submitted — awaiting verification." : next.status === "EXPECTED" ? "Awaiting your contribution." : next.status}</p>
              {next.status === "EXPECTED" && <SubmitContribution key={next.schedule_id} group={group} contribution={next} refresh={refresh} onResolved={setNotice} />}</>}
        </section>
        <section className="dashboard-card"><h2>Current cycle</h2>
          {group.status === "DRAFT" ? <p className="muted">Cycles will be generated when the group is activated.</p>
            : group.status === "CANCELLED" ? <p className="muted">This group has no active cycles.</p>
            : !cycle ? <p className="muted">No cycle is scheduled for today.{group.start_date > utcToday() ? ` The group starts ${formatDate(group.start_date)}.` : ""}</p>
            : <><p><strong>Cycle {cycle.cycle_number}</strong> · {cycle.status.toLowerCase()}</p>
              <p>{formatDate(cycle.period_start)} – {formatDate(cycle.period_end)}</p>
              <p>Expected payout: {formatAmount(cycle.expected_amount, group.currency)}</p></>}
        </section>
        <section className="dashboard-card"><h2>Members and group actions</h2>
          {group.status === "DRAFT" && canAdmin && <InviteMember group={group} refresh={draftChanged} />}
          <MemberRoles group={group} refresh={refresh} canManage={role === "OWNER" && group.status !== "CANCELLED"} />
          {group.status === "ACTIVE" && canVerify && <VerifyContributions group={group} refresh={refresh} onResolved={setNotice} />}
        </section>
        <section className="dashboard-card"><h2>Recent activity</h2>
          {data.recent_activity.length === 0 ? <p className="muted">No activity yet.</p> : <ul className="activity-list">{data.recent_activity.map((item, index) => <li key={`${item.action}-${item.entity_id}-${item.created_at}-${index}`}>
            <span>{activityLabels[item.action] ?? item.action.replaceAll("_", " ").toLowerCase()}</span>
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
          </li>)}</ul>}
        </section>
      </div>}
  </>;
}
