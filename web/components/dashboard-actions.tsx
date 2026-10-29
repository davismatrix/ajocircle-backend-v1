"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/current-user";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";
import { AjoGroup, ContributionStatus, DashboardContribution, InvitationPage, Member, PendingContributions, formatAmount, formatDate } from "@/lib/ajo";

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Unable to connect. Check the group before trying again.";
}

export function InviteMember({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { data: invitations, error: listError, retry, refresh: refreshList } = useResource<InvitationPage>(`/ajo-groups/${group.id}/invitations?page=${page}`);
  function changed() { if (page !== 1) setPage(1); else refreshList(); refresh(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null); setMessage(null);
    try {
      await api(`/ajo-groups/${group.id}/invitations`, { method: "POST", body: JSON.stringify({ phone_number: String(data.get("phone_number")), role: String(data.get("role")) }) });
      setMessage("Invitation created. Copy the token from the pending invitations below."); changed();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError(`${errorMessage(error)} Check pending invitations before retrying.`); changed();
    } finally { setBusy(false); }
  }
  async function cancel(invitationId: string) {
    if (busy || !window.confirm("Cancel this invitation? Its token will no longer work.")) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await api(`/ajo-groups/${group.id}/invitations/${invitationId}/cancel`, { method: "POST" });
      setMessage("Invitation cancelled."); changed();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError(`${errorMessage(error)} Check the refreshed invitation list.`); changed();
    } finally { setBusy(false); }
  }
  return <details className="dashboard-action"><summary>Invite a member</summary>
    <p className="muted">The invited account must have the same phone number. Share the token with them securely.</p>
    <form onSubmit={submit}>
      <label>Phone number<input name="phone_number" type="tel" required minLength={7} maxLength={30} placeholder="+14165550101" /></label>
      <label>Role<select name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="TREASURER">Treasurer</option></select></label>
      <button disabled={busy}>{busy ? "Please wait…" : "Create invitation"}</button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <h3>Pending invitations</h3>
    <button type="button" className="secondary" disabled={busy} onClick={refreshList}>Refresh invitations</button>
    <p className="hint">Messages are not sent automatically. Tokens remain available here until accepted, cancelled, or expired.</p>
    {listError ? <><p role="alert" className="error">{listError}</p><button onClick={retry}>Retry invitation list</button></>
      : !invitations ? <p role="status">Loading invitations…</p>
      : <>{invitations.items.length === 0 ? <p>No pending invitations on this page.</p> : <ul className="pending-list">{invitations.items.map((invitation) => <li key={invitation.id}>
        <strong>{invitation.phone_number}</strong> · {invitation.role.toLowerCase()} · Expires {new Date(invitation.expires_at).toLocaleString()}
        <label>Invitation token for {invitation.phone_number}<input readOnly value={invitation.token} onFocus={(event) => event.currentTarget.select()} /></label>
        <button className="secondary" disabled={busy} onClick={() => cancel(invitation.id)}>Cancel invitation for {invitation.phone_number}</button>
      </li>)}</ul>}
      <div className="pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous invitations</button>
        <span>Page {page} of {Math.max(1, Math.ceil(invitations.total / invitations.page_size))}</span>
        <button className="secondary" disabled={page * invitations.page_size >= invitations.total || busy} onClick={() => setPage(page + 1)}>Next invitations</button></div></>}
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

type PendingSubmission = { schedule_id: string; amount: string; payment_method: string; payment_reference: string };
function readSubmission(key: string): PendingSubmission | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); return value?.schedule_id && value?.payment_reference ? value : null; }
  catch { return null; }
}

export function SubmitContribution({ group, contribution, refresh, onResolved }: { group: AjoGroup; contribution: DashboardContribution; refresh: () => void; onResolved: (message: string) => void }) {
  const router = useRouter();
  const user = useCurrentUser();
  const storageKey = `ajocircle.pending-contribution.${user.id}.${group.id}.${contribution.schedule_id}`;
  const [restored] = useState(() => readSubmission(storageKey));
  const pending = useRef<PendingSubmission | null>(restored);
  const [recovering, setRecovering] = useState(Boolean(restored));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  function save(value: PendingSubmission | null) {
    pending.current = value;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }
    catch { /* Same-page retries still retain their original payment details. */ }
  }
  async function reconcile() {
    try {
      const status = await api<ContributionStatus>(`/contributions/schedules/${contribution.schedule_id}/status`);
      if (status.contribution_status) {
        const same = !pending.current || (pending.current.payment_method === status.payment_method && pending.current.payment_reference === status.payment_reference);
        save(null); setRecovering(false); setSuccess(true); refresh();
        const message = !same ? "A contribution with different payment details already exists. Contact a group administrator."
          : status.contribution_status === "VERIFIED" ? "Your contribution has been verified."
          : status.contribution_status === "SUBMITTED" ? "Your contribution was submitted and is awaiting verification."
          : `A contribution has status ${status.contribution_status}. Contact a group administrator.`;
        onResolved(message);
      } else {
        setRecovering(true);
        setError("No submission is recorded yet. Retry using the original payment details or check the status again.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setRecovering(true); setError("Unable to check submission status. Check again before changing payment details.");
    }
  }
  async function checkStatus() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await reconcile(); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    const payload = recovering && pending.current ? pending.current : {
      schedule_id: contribution.schedule_id, amount: contribution.expected_amount,
      payment_method: String(data.get("payment_method")).trim(), payment_reference: String(data.get("payment_reference")).trim(),
    };
    setBusy(true); setError(null); save(payload);
    try {
      const result = await api<{ status: string }>(`/contributions/${contribution.schedule_id}/submit`, { method: "POST", body: JSON.stringify({
        amount: payload.amount, payment_method: payload.payment_method, payment_reference: payload.payment_reference,
      }) });
      const message = result.status === "VERIFIED" ? "Your contribution has been verified."
        : result.status === "SUBMITTED" ? "Your contribution was submitted and is awaiting verification."
        : `Contribution status: ${result.status}.`;
      save(null); setSuccess(true); setSuccessMessage(message); onResolved(message); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      if (error instanceof ApiError && error.status < 500 && ![408, 409, 429].includes(error.status)) {
        save(null); setRecovering(false); setError(error.message);
      } else { setRecovering(true); await reconcile(); }
    } finally { setBusy(false); }
  }
  return <details className="dashboard-action" open={recovering || undefined}><summary>Submit contribution</summary>
    <p className="muted">Record a payment you made separately. The full amount is {formatAmount(contribution.expected_amount, group.currency)}.</p>
    {recovering && <p role="status">A submission is awaiting confirmation. The original payment details are retained for a safe retry.</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy || recovering}>
        <label>Payment method<input name="payment_method" required minLength={2} maxLength={30} defaultValue={restored?.payment_method} placeholder="Bank transfer" /></label>
        <label>Payment reference<input name="payment_reference" required maxLength={255} defaultValue={restored?.payment_reference} /></label>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p role="status">{successMessage}</p>}
      <button disabled={busy || success}>{busy ? "Checking…" : recovering ? "Retry submission" : "Submit contribution"}</button>
      {recovering && <button type="button" className="secondary" disabled={busy} onClick={checkStatus}>Check submission status</button>}
    </form>
  </details>;
}

export function VerifyContributions({ group, refresh, onResolved }: { group: AjoGroup; refresh: () => void; onResolved: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-action" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Review submitted contributions</summary>
    {open && <PendingList group={group} refresh={refresh} onResolved={onResolved} />}
  </details>;
}

function PendingList({ group, refresh, onResolved }: { group: AjoGroup; refresh: () => void; onResolved: (message: string) => void }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const { data, error, retry } = useResource<PendingContributions>(`/ajo-groups/${group.id}/contributions/pending?page=${page}`);
  function confirmed() {
    setUncertain(null); setActionError(null);
    if (data && data.items.length === 1 && page > 1) setPage(page - 1); else retry();
    onResolved("Contribution verified."); refresh();
  }
  async function reconcile(id: string) {
    try {
      const status = await api<ContributionStatus>(`/contributions/${id}/status`);
      if (status.contribution_status === "VERIFIED") confirmed();
      else { setUncertain(null); setActionError("Verification is not recorded. Review the payment and retry if appropriate."); }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setUncertain(id); setActionError("Unable to check verification status. Check again before retrying.");
    }
  }
  async function checkStatus(id: string) {
    if (busy) return;
    setBusy(id); setActionError(null);
    try { await reconcile(id); } finally { setBusy(null); }
  }
  async function verify(id: string) {
    if (busy || uncertain === id || !window.confirm("Verify this contribution after confirming the payment was received?")) return;
    setBusy(id); setActionError(null);
    try { await api(`/contributions/${id}/verify`, { method: "POST" }); confirmed(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      if (error instanceof ApiError && error.status < 500 && ![408, 409, 429].includes(error.status)) setActionError(error.message);
      else { setUncertain(id); await reconcile(id); }
    } finally { setBusy(null); }
  }

  if (error) return <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>;
  if (!data) return <p role="status">Loading submitted contributions…</p>;
  return <>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {data.items.length === 0 ? <p>No submitted contributions on this page.</p> : <ul className="pending-list">{data.items.map((item) => <li key={item.contribution_id}>
      <strong>{item.first_name} {item.last_name}</strong><p>Cycle {item.cycle_number} · Due {formatDate(item.due_date)} · {formatAmount(item.paid_amount, group.currency)}</p>
      <p>Method: {item.payment_method || "Not provided"} · Reference: {item.payment_reference || "Not provided"}</p>
      <button disabled={Boolean(busy) || uncertain === item.contribution_id} onClick={() => verify(item.contribution_id)}>{busy === item.contribution_id ? "Verifying…" : `Verify ${item.first_name} ${item.last_name}’s contribution`}</button>
      {uncertain === item.contribution_id && <button className="secondary" disabled={Boolean(busy)} onClick={() => checkStatus(item.contribution_id)}>Check verification status for {item.first_name} {item.last_name}</button>}
    </li>)}</ul>}
    <div className="pagination"><button className="secondary" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
      <button className="secondary" disabled={page * data.page_size >= data.total || Boolean(busy)} onClick={() => setPage(page + 1)}>Next</button></div>
  </>;
}
