"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence, RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from "firebase/auth";
import { api, ApiError, CurrentUser, getCurrentUser } from "@/lib/api";

type Verification = { attempt_id: string | null; phone_number: string | null; already_verified: boolean };
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function firebasePhoneError(caught: unknown): string {
  const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
  const messages: Record<string, string> = {
    "auth/unauthorized-domain": "This domain is not authorized for Firebase phone authentication. Check Firebase Authentication settings.",
    "auth/invalid-app-credential": "Firebase could not validate this app. Check the authorized domain and reCAPTCHA, then try again.",
    "auth/captcha-check-failed": "The security check failed. Complete reCAPTCHA and try again.",
    "auth/too-many-requests": "Firebase has temporarily limited verification requests. Please wait before trying again.",
    "auth/billing-not-enabled": "Firebase SMS billing is not enabled for this project. Contact support.",
    "auth/operation-not-allowed": "Phone sign-in or the destination's SMS region is disabled in Firebase. Contact support.",
    "auth/invalid-phone-number": "Enter a valid phone number with its country code.",
  };
  if (messages[code]) return messages[code];
  if (caught instanceof Error && caught.message.startsWith("Phone verification is not configured")) return caught.message;
  return `Unable to send an SMS verification code. Please try again.${/^auth\/[a-z-]+$/.test(code) ? ` (${code})` : ""}`;
}

export function PhoneVerificationForm({ user, onVerified }: { user: CurrentUser; onVerified: (user: CurrentUser) => void }) {
  const router = useRouter();
  const [phone, setPhone] = useState(user.phone_number ?? "");
  const [pending, setPending] = useState<Verification | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);
  const recaptchaContainer = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const sending = useRef(false);
  const handleSession = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) {
      router.replace(window.location.pathname === "/invitations/accept" ? "/login?next=%2Finvitations%2Faccept" : "/login");
      return true;
    }
    return false;
  }, [router]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recaptcha.current?.clear();
      recaptcha.current = null;
    };
  }, []);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sending.current) return;
    sending.current = true;
    setBusy(true); setError(null); setConfirmation(null); setToken(null);
    try {
      if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) throw new Error("Phone verification is not configured. Contact support.");
      const app = getApps().find((item) => item.name === "phone-verification") ?? initializeApp(firebaseConfig, "phone-verification");
      const auth = getAuth(app);
      await setPersistence(auth, inMemoryPersistence);
      await signOut(auth);
      const result = await api<Verification>("/auth/phone-verification/start", { method: "POST", body: JSON.stringify({ phone_number: phone }) });
      if (!mounted.current) return;
      if (result.already_verified) { onVerified(await getCurrentUser()); return; }
      setPending(result);
      const container = recaptchaContainer.current;
      if (!container?.isConnected) return;
      // Keep the visible widget mounted across sends. Firebase resets its token
      // after an SMS request; destroying it here can race Google's callbacks.
      recaptcha.current ??= new RecaptchaVerifier(auth, container, { size: "normal" });
      const verifier = recaptcha.current;
      await verifier.render();
      if (!mounted.current || recaptcha.current !== verifier) return;
      const next = await signInWithPhoneNumber(auth, result.phone_number ?? phone, verifier);
      if (mounted.current) setConfirmation(next);
    } catch (caught) {
      if (mounted.current && !handleSession(caught)) {
        setError(caught instanceof ApiError ? caught.message : firebasePhoneError(caught));
      }
      // Do not clear the widget here: reCAPTCHA may still be finishing its UI.
      // The Firebase SDK resets it when signInWithPhoneNumber fails.
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pending?.attempt_id || (!confirmation && !token)) return;
    setBusy(true); setError(null);
    try {
      let idToken = token;
      if (!idToken && confirmation) {
        const result = await confirmation.confirm(String(new FormData(event.currentTarget).get("code")));
        idToken = await result.user.getIdToken();
        setToken(idToken);
      }
      const verified = await api<CurrentUser>("/auth/phone-verification/check", { method: "POST", body: JSON.stringify({ attempt_id: pending.attempt_id, firebase_id_token: idToken }) });
      setPending(null); setToken(null); onVerified(verified);
    } catch (caught) {
      if (handleSession(caught)) return;
      if (!(caught instanceof ApiError) || caught.status >= 500 || caught.status === 408) {
        try {
          const current = await getCurrentUser();
          if (current.phone_verified && current.phone_number === pending.phone_number) { setPending(null); setToken(null); onVerified(current); return; }
        } catch { /* Allow retry when account state is unavailable. */ }
      }
      setError(caught instanceof ApiError ? caught.message : token ? "Unable to confirm verification. Please retry." : "Invalid or expired code, or verification is unavailable. Please try again.");
    } finally { setBusy(false); }
  }

  return <section className="phone-verification"><h2>Verify your phone number</h2>
    <p className="muted">Enter your phone number with its country code. Google will send an SMS and use the number for spam and abuse prevention.</p>
    <div ref={recaptchaContainer} />
    {!confirmation ? <form onSubmit={start}>
      <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={7} maxLength={30} autoComplete="tel" placeholder="+14165550101" /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Sending…" : "Send verification code"}</button>
    </form> : <>
      <p>A code was requested for <strong>{pending?.phone_number}</strong>.</p>
      <form onSubmit={check}>
        <label>Verification code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required={!token} pattern="[0-9]{4,10}" minLength={4} maxLength={10} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Checking…" : "Verify phone number"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setConfirmation(null); setPending(null); setToken(null); setError(null); }}>Use a different number or resend</button>
      </form>
    </>}
  </section>;
}
