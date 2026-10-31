"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError, login, register } from "@/lib/api";

type Mode = "login" | "register";

export function AuthForm({ mode, continueInvitation = false }: { mode: Mode; continueInvitation?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const data = new FormData(event.currentTarget);
    try {
      await (mode === "login"
        ? login({ email: String(data.get("email")), password: String(data.get("password")) })
        : register({
            first_name: String(data.get("first_name")),
            last_name: String(data.get("last_name")),
            email: String(data.get("email")),
            phone_number: String(data.get("phone_number")) || undefined,
            password: String(data.get("password")),
          }));
      router.replace(continueInvitation ? "/invitations/accept" : "/dashboard");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to reach the API. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const registering = mode === "register";
  const nextPath = continueInvitation ? "?next=%2Finvitations%2Faccept" : "";
  return <main className="auth-shell">
    <section className="auth-card">
      <p className="eyebrow">AjoCircle</p>
      <h1>{registering ? "Create your account" : "Welcome back"}</h1>
      <p className="muted">{registering ? "Start or join a trusted savings circle." : "Sign in to view your Ajos."}</p>
      <form onSubmit={submit}>
        {registering && <div className="field-row">
          <label>First name<input required name="first_name" autoComplete="given-name" /></label>
          <label>Last name<input required name="last_name" autoComplete="family-name" /></label>
        </div>}
        <label>Email<input required type="email" name="email" autoComplete="email" /></label>
        {registering && <label>Phone number<input name="phone_number" type="tel" autoComplete="tel" placeholder="+14165550101" /><span className="hint">Include the country code. You can verify this number after registration.</span></label>}
        <label>Password<input required type="password" name="password" minLength={8} maxLength={72} autoComplete={registering ? "new-password" : "current-password"} /></label>
        {registering && <p className="hint">Use at least 8 characters. Passwords are limited to 72 bytes.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={isSubmitting} type="submit">{isSubmitting ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
      </form>
      <p className="switch">{registering ? "Already have an account?" : "New to AjoCircle?"} <Link href={`${registering ? "/login" : "/register"}${nextPath}`}>{registering ? "Sign in" : "Create one"}</Link></p>
    </section>
  </main>;
}
