"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";
import { AjoGroup, DashboardContribution, Member, PendingContributions, formatAmount, formatDate } from "@/lib/ajo";

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Unable to connect. Check the group before trying again.";
}

export function InviteMember({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<{ token: string; expires_at: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const result = await api<{ token: string; expires_at: string }>(`/ajo-groups/${group.id}/invitations`, {
        method: "POST", body: JSON.stringify({ phone_number: String(data.get("phone_number")), role: String(data.get("role")) }),
      });
      setInvitation(result); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <details className="dashboard-action"><summary>Invite a member</summary>
    <p className="muted">The invited account must have the same phone number. Share the token with them securely.</p>
    <form onSubmit={submit}>
      <label>Phone number<input name="phone_number" type="tel" required minLength={7} maxLength={30} placeholder="+14165550101" /></label>
      <label>Role<select name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="TREASURER">Treasurer</option></select></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Creating invitation…" : "Create invitation"}</button>
    </form>
    {invitation && <div className="invitation-result" role="status"><p>Invitation token (expires {new Date(invitation.expires_at).toLocaleString()}):</p>
      <label>Invitation token<input readOnly value={invitation.token} onFocus={(event) => event.currentTarget.select()} /></label>
      <p className="hint">Select and copy the token to share it. Messages are not sent automatically.</p></div>}
  </details>;
}

export function MemberRoles({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-action" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Manage member roles</summary>
    {open && <MemberRoleList group={group} refresh={refresh} />}
  </details>;
}

function MemberRoleList({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const router = useRouter();
  const { data: members, error, retry } = useResource<Member[]>(`/ajo-groups/${group.id}/members`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  async function update(member: Member, role: string) {
    if (busy || role === member.role) return;
    setBusy(member.id); setActionError(null);
    try {
      await api(`/ajo-groups/${group.id}/members/${member.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      retry(); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setActionError(errorMessage(error));
    } finally { setBusy(null); }
  }
  if (error) return <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>;
  if (!members) return <p role="status">Loading members…</p>;
  return <><p className="muted">Only the owner can change roles.</p>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    <ul className="member-list">{members.map((member) => <li key={member.id}>
      <span>{member.first_name} {member.last_name} <span className="muted">({member.email})</span></span>
      {member.role === "OWNER" ? <strong>Owner</strong> : <label>Role for {member.first_name} {member.last_name}<select value={member.role} disabled={Boolean(busy)} onChange={(event) => update(member, event.target.value)}>
        <option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="TREASURER">Treasurer</option></select></label>}
    </li>)}</ul></>;
}

export function SubmitContribution({ group, contribution, refresh }: { group: AjoGroup; contribution: DashboardContribution; refresh: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/contributions/${contribution.schedule_id}/submit`, { method: "POST", body: JSON.stringify({
        amount: contribution.expected_amount, payment_method: String(data.get("payment_method")).trim(), payment_reference: String(data.get("payment_reference")).trim(),
      }) });
      setSuccess(true); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <details className="dashboard-action"><summary>Submit contribution</summary>
    <p className="muted">Record a payment you made separately. The full amount is {formatAmount(contribution.expected_amount, group.currency)}.</p>
    <form onSubmit={submit}>
      <label>Payment method<input name="payment_method" required minLength={2} maxLength={30} placeholder="Bank transfer" /></label>
      <label>Payment reference<input name="payment_reference" required maxLength={255} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p role="status">Contribution submitted for verification.</p>}
      <button disabled={busy || success}>{busy ? "Submitting…" : "Submit contribution"}</button>
    </form>
  </details>;
}

export function VerifyContributions({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-action" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Review submitted contributions</summary>
    {open && <PendingList group={group} refresh={refresh} />}
  </details>;
}

function PendingList({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, retry } = useResource<PendingContributions>(`/ajo-groups/${group.id}/contributions/pending?page=${page}`);
  async function verify(id: string) {
    if (busy || !window.confirm("Verify this contribution after confirming the payment was received?")) return;
    setBusy(id); setActionError(null);
    try {
      await api(`/contributions/${id}/verify`, { method: "POST" });
      if (data && data.items.length === 1 && page > 1) setPage(page - 1); else retry();
      refresh();
    }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setActionError(errorMessage(error));
    } finally { setBusy(null); }
  }
  if (error) return <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>;
  if (!data) return <p role="status">Loading submitted contributions…</p>;
  return <>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {data.items.length === 0 ? <p>No submitted contributions on this page.</p> : <ul className="pending-list">{data.items.map((item) => <li key={item.contribution_id}>
      <strong>{item.first_name} {item.last_name}</strong><p>Cycle {item.cycle_number} · Due {formatDate(item.due_date)} · {formatAmount(item.paid_amount, group.currency)}</p>
      <p>Method: {item.payment_method || "Not provided"} · Reference: {item.payment_reference || "Not provided"}</p>
      <button disabled={Boolean(busy)} onClick={() => verify(item.contribution_id)}>{busy === item.contribution_id ? "Verifying…" : `Verify ${item.first_name} ${item.last_name}’s contribution`}</button>
    </li>)}</ul>}
    <div className="pagination"><button className="secondary" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
      <button className="secondary" disabled={page * data.page_size >= data.total || Boolean(busy)} onClick={() => setPage(page + 1)}>Next</button></div>
  </>;
}
