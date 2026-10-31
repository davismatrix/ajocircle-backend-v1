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

function CopyInvitation({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied.");
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage("Automatic copying is unavailable. The text is selected; use your device’s copy command.");
    }
  }
  return <div>
    <label>{label}<input ref={input} readOnly value={value} onFocus={(event) => event.currentTarget.select()} /></label>
    <button type="button" className="secondary" onClick={copy}>Copy {label.toLowerCase()}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}

export function InviteMember({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-action" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Invite a member</summary>
    {open && <InvitationPanel group={group} refresh={refresh} />}
  </details>;
}

function InvitationPanel({ group, refresh }: { group: AjoGroup; refresh: () => void }) {
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
      setMessage("Invitation created. Copy the link or token from the pending invitations below."); changed();
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
  return <>
    <p className="muted">The invited account must verify this phone number before joining. Share the invitation link securely.</p>
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
        <CopyInvitation label={`Invitation token for ${invitation.phone_number}`} value={invitation.token} />
        <CopyInvitation label={`Invitation link for ${invitation.phone_number}`} value={`${window.location.origin}/invitations/accept#token=${encodeURIComponent(invitation.token)}`} />
        <button className="secondary" disabled={busy} onClick={() => cancel(invitation.id)}>Cancel invitation for {invitation.phone_number}</button>
      </li>)}</ul>}
      <div className="pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous invitations</button>
        <span>Page {page} of {Math.max(1, Math.ceil(invitations.total / invitations.page_size))}</span>
        <button className="secondary" disabled={page * invitations.page_size >= invitations.total || busy} onClick={() => setPage(page + 1)}>Next invitations</button></div></>}
  </>;
}

export function MemberRoles({ group, refresh, canManage }: { group: AjoGroup; refresh: () => void; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-action" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{canManage ? "Manage member roles" : "View members"}</summary>
    {open && <MemberRoleList group={group} refresh={refresh} canManage={canManage} />}
  </details>;
}

function MemberRoleList({ group, refresh, canManage }: { group: AjoGroup; refresh: () => void; canManage: boolean }) {
  const router = useRouter();
  const { data: members, error, retry } = useResource<Member[]>(`/ajo-groups/${group.id}/members`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<{ member: Member; role: string } | null>(null);
  function confirmed(member: Member, role: string) {
    setUncertain(null); setActionError(null);
    setMessage(`Role for ${member.first_name} ${member.last_name} saved as ${role.toLowerCase()}.`);
    retry(); refresh();
  }
  async function reconcile(member: Member, role: string) {
    try {
      const current = await api<Member[]>(`/ajo-groups/${group.id}/members`);
      const saved = current.find((item) => item.id === member.id);
      if (saved?.role === role) confirmed(member, role);
      else {
        setUncertain(null); retry(); refresh();
        setActionError("The refreshed roster does not show the requested role. Review it before making another change.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setUncertain({ member, role });
      setActionError("Unable to confirm the role change. Check member roles before making another change.");
    }
  }
  async function checkRoles() {
    if (busy || !uncertain) return;
    setBusy(uncertain.member.id);
    try { await reconcile(uncertain.member, uncertain.role); } finally { setBusy(null); }
  }
  async function update(member: Member, role: string) {
    if (busy || uncertain || role === member.role) return;
    setBusy(member.id); setActionError(null); setMessage(null);
    try {
      await api(`/ajo-groups/${group.id}/members/${member.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      confirmed(member, role);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      if (!(error instanceof ApiError) || error.status >= 500 || [408, 409, 429].includes(error.status)) {
        await reconcile(member, role);
      } else { setActionError(errorMessage(error)); retry(); refresh(); }
    } finally { setBusy(null); }
  }
  return <><p className="muted">Only the owner can change roles.</p>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {message && <p role="status">{message}</p>}
    {uncertain && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={checkRoles}>Check member roles</button>}
    {error ? <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>
      : !members ? <p role="status">Loading members…</p>
      : members.length === 0 ? <p>No active members.</p>
      : <ul className="member-list">{members.map((member) => <li key={member.id}>
        <span>{member.first_name} {member.last_name}{member.payout_position != null && <span className="muted"> · Payout position {member.payout_position}</span>}</span>
        {!canManage || member.role === "OWNER" ? <strong>{member.role.toLowerCase()}</strong> : <label>Role for {member.first_name} {member.last_name}<select value={member.role} disabled={Boolean(busy) || Boolean(uncertain)} onChange={(event) => update(member, event.target.value)}>
          <option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="TREASURER">Treasurer</option></select></label>}
      </li>)}</ul>}
  </>;
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
  const inFlight = useRef(false);
  const [method, setMethod] = useState(restored?.payment_method ?? "");
  const [reference, setReference] = useState(restored?.payment_reference ?? "");
  const [reviewed, setReviewed] = useState<PendingSubmission | null>(null);
  const [recovering, setRecovering] = useState(Boolean(restored));
  const [open, setOpen] = useState(Boolean(restored));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  function save(value: PendingSubmission | null) {
    pending.current = value;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }
    catch { /* Same-page retries still retain their original payment details. */ }
  }
  function resolved(message: string) {
    save(null); setRecovering(false); setReviewed(null); setSuccessMessage(message);
    setOpen(true); onResolved(message); refresh();
  }
  async function reconcile() {
    try {
      const status = await api<ContributionStatus>(`/contributions/schedules/${contribution.schedule_id}/status`);
      if (status.contribution_status) {
        const same = !pending.current || (pending.current.payment_method === status.payment_method && pending.current.payment_reference === status.payment_reference);
        resolved(!same ? "A contribution with different payment details already exists. Contact a group administrator."
          : status.contribution_status === "VERIFIED" ? "Your contribution has been verified."
          : status.contribution_status === "SUBMITTED" ? "Your contribution was submitted and is awaiting verification."
          : `A contribution has status ${status.contribution_status}. Contact a group administrator.`);
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
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await reconcile(); } finally { inFlight.current = false; setBusy(false); }
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || successMessage) return;
    const payment_method = method.trim();
    const payment_reference = reference.trim();
    if (payment_method.length < 2 || !payment_reference) {
      setError("Enter a payment method of at least two characters and a payment reference; blank spaces are not sufficient.");
      return;
    }
    setError(null); setOpen(true);
    setReviewed({ schedule_id: contribution.schedule_id, amount: contribution.expected_amount, payment_method, payment_reference });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = recovering ? pending.current : reviewed;
    if (inFlight.current || successMessage || !payload) return;
    inFlight.current = true;
    setBusy(true); setError(null); save(payload);
    try {
      const result = await api<{ status: string }>(`/contributions/${payload.schedule_id}/submit`, { method: "POST", body: JSON.stringify({
        amount: payload.amount, payment_method: payload.payment_method, payment_reference: payload.payment_reference,
      }) });
      resolved(result.status === "VERIFIED" ? "Your contribution has been verified."
        : result.status === "SUBMITTED" ? "Your contribution was submitted and is awaiting verification."
        : `Contribution status: ${result.status}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setReviewed(null);
      if (error instanceof ApiError && error.status < 500 && ![408, 409, 429].includes(error.status)) {
        save(null); setRecovering(false); setError(error.message);
      } else { setRecovering(true); await reconcile(); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <details className="dashboard-action" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Submit contribution</summary>
    <p className="muted">Record a payment you made separately. The full amount is {formatAmount(contribution.expected_amount, group.currency)}.</p>
    {successMessage ? <p role="status">{successMessage}</p> : reviewed && !recovering ? <form onSubmit={submit} aria-label="Review contribution">
      <h3>Review contribution</h3>
      <dl className="group-details">
        <div><dt>Amount</dt><dd>{formatAmount(reviewed.amount, group.currency)}</dd></div>
        <div><dt>Due date</dt><dd>{formatDate(contribution.due_date)}</dd></div>
        <div><dt>Payment method</dt><dd>{reviewed.payment_method}</dd></div>
        <div><dt>Payment reference</dt><dd>{reviewed.payment_reference}</dd></div>
      </dl>
      <p>This records your payment for a group administrator to verify.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? "Submitting…" : "Confirm submission"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setReviewed(null)}>Edit payment details</button>
    </form> : <>
      {recovering && <p role="status">A submission is awaiting confirmation. The original payment details are retained for a safe retry.</p>}
      <form onSubmit={recovering ? submit : review}>
        <fieldset disabled={busy || recovering}>
          <label>Amount<input readOnly value={formatAmount(contribution.expected_amount, group.currency)} /></label>
          <label>Payment method<input name="payment_method" required minLength={2} maxLength={30} value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Bank transfer" /></label>
          <label>Payment reference<input name="payment_reference" required maxLength={255} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        </fieldset>
        {error && <p role="alert" className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Checking…" : recovering ? "Retry submission" : "Submit contribution"}</button>
        {recovering && <button type="button" className="secondary" disabled={busy} onClick={checkStatus}>Check submission status</button>}
      </form>
    </>}
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
  const inFlight = useRef(false);
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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(id); setActionError(null);
    try { await reconcile(id); } finally { inFlight.current = false; setBusy(null); }
  }
  async function verify(id: string) {
    if (inFlight.current || uncertain || !window.confirm("Verify this contribution after confirming the payment was received?")) return;
    inFlight.current = true;
    setBusy(id); setActionError(null);
    try { await api(`/contributions/${id}/verify`, { method: "POST" }); confirmed(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      if (error instanceof ApiError && error.status < 500 && ![408, 409, 429].includes(error.status)) setActionError(error.message);
      else { setUncertain(id); await reconcile(id); }
    } finally { inFlight.current = false; setBusy(null); }
  }

  if (error) return <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>;
  if (!data) return <p role="status">Loading submitted contributions…</p>;
  return <>
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {data.items.length === 0 ? <p>No submitted contributions on this page.</p> : <ul className="pending-list">{data.items.map((item) => <li key={item.contribution_id}>
      <strong>{item.first_name} {item.last_name}</strong><p>Cycle {item.cycle_number} · Due {formatDate(item.due_date)} · {formatAmount(item.paid_amount, group.currency)}</p>
      <p>Method: {item.payment_method || "Not provided"} · Reference: {item.payment_reference || "Not provided"}</p>
      <button disabled={Boolean(busy) || Boolean(uncertain)} onClick={() => verify(item.contribution_id)}>{busy === item.contribution_id ? "Verifying…" : `Verify ${item.first_name} ${item.last_name}’s contribution`}</button>
      {uncertain === item.contribution_id && <button className="secondary" disabled={Boolean(busy)} onClick={() => checkStatus(item.contribution_id)}>Check verification status for {item.first_name} {item.last_name}</button>}
    </li>)}</ul>}
    <div className="pagination"><button className="secondary" disabled={page <= 1 || Boolean(busy) || Boolean(uncertain)} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
      <button className="secondary" disabled={page * data.page_size >= data.total || Boolean(busy) || Boolean(uncertain)} onClick={() => setPage(page + 1)}>Next</button></div>
  </>;
}
