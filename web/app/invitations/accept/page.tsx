"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, CurrentUser, getCurrentUser, logout } from "@/lib/api";
import { PhoneVerificationForm } from "@/components/phone-verification-form";

const STORAGE_KEY = "ajocircle.invitation-token";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AcceptedInvitation = { id: string; ajo_group_id: string; role: string };

function remember(token: string) {
  try { if (token) sessionStorage.setItem(STORAGE_KEY, token); else sessionStorage.removeItem(STORAGE_KEY); return true; }
  catch { return false; }
}

export default function AcceptInvitationPage() {
  const captured = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyOther, setVerifyOther] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Fragments are not sent to the server; remove the token from the address bar after capture.
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("token");
    let saved = captured.current ?? "";
    try { saved = sessionStorage.getItem(STORAGE_KEY) ?? saved; } catch { /* Token can still be pasted after sign-in. */ }
    if (fromLink !== null) {
      captured.current = fromLink;
      saved = fromLink;
      const stored = remember(fromLink);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      Promise.resolve().then(() => { if (!controller.signal.aborted) setStorageAvailable(stored); });
    }
    Promise.resolve().then(() => { if (!controller.signal.aborted) setToken(saved); });
    getCurrentUser().then((current) => {
      if (!controller.signal.aborted) { setUser(current); setAuthError(null); setLoading(false); }
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setUser(null);
      setAuthError(caught instanceof ApiError && caught.status === 401 ? null : "Unable to check your session. Please try again.");
      setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  const changeToken = useCallback((value: string) => {
    captured.current = value;
    setToken(value);
    setStorageAvailable(remember(value.trim()));
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = token.trim();
    if (!UUID_PATTERN.test(value)) { setError("Enter a valid invitation token."); return; }
    setBusy(true); setError(null); remember(value);
    try {
      const result = await api<AcceptedInvitation>("/ajo-groups/invitations/accept", { method: "POST", body: JSON.stringify({ token: value }) });
      captured.current = ""; remember(""); setAccepted(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) { setUser(null); setError("Your session has expired. Sign in to continue."); }
      else setError(caught instanceof ApiError ? caught.message : "Unable to confirm acceptance. Retry with the same token.");
    } finally { setBusy(false); }
  }

  async function switchAccount() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await logout(); setUser(null); }
    catch { setError("Unable to sign out. Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell"><section className="auth-card invitation-card">
    <p className="eyebrow">AjoCircle</p><h1>Join a savings group</h1>
    {loading ? <p role="status">Checking your session…</p>
      : authError ? <><p className="error" role="alert">{authError}</p><button onClick={() => { setLoading(true); setAttempt((value) => value + 1); }}>Try again</button></>
      : accepted ? <><p role="status">You joined the group as {accepted.role.toLowerCase()}.</p><Link className="button-link" href={`/dashboard/ajos/${accepted.ajo_group_id}`}>View group</Link><p><Link href="/dashboard">My Ajos</Link></p></>
      : <>
        <p className="muted">Enter your invitation token. Your account phone number must match the invited number.</p>
        {user ? <><p>Signed in as <strong>{user.first_name} {user.last_name}</strong> ({user.email})</p>
          <p className="muted">Account phone: {user.phone_number || "Not provided"}</p>
          <button type="button" className="secondary" disabled={busy} onClick={switchAccount}>Use another account</button>
          {!user.phone_verified ? <PhoneVerificationForm user={user} onVerified={(verified) => { setUser(verified); setError(null); }} /> : <p role="status">Phone number verified.</p>}
          {user.phone_verified && <details onToggle={(event) => setVerifyOther(event.currentTarget.open)}><summary>Verify a different number</summary>{verifyOther && <PhoneVerificationForm user={user} onVerified={(verified) => { setUser(verified); setError(null); }} />}</details>}
          <form onSubmit={accept}>
            <label>Invitation token<input value={token} onChange={(event) => changeToken(event.target.value)} required maxLength={36} autoComplete="off" aria-invalid={Boolean(error)} /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button disabled={busy || !user.phone_verified}>{busy ? "Joining group…" : "Accept invitation"}</button>
          </form>
          <p><Link href="/dashboard">Back to My Ajos</Link></p></>
          : <>
            <label>Invitation token<input value={token} onChange={(event) => changeToken(event.target.value)} maxLength={36} autoComplete="off" /></label>
            {!storageAvailable && <p className="hint">Keep this token handy; you will need to paste it again after signing in.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <p><Link className="button-link" href="/login?next=%2Finvitations%2Faccept">Sign in to continue</Link></p>
            <p>New to AjoCircle? <Link href="/register?next=%2Finvitations%2Faccept">Create an account</Link> with the invited phone number.</p>
          </>}
      </>}
  </section></main>;
}
