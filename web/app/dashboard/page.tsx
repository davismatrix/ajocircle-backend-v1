"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CurrentUser, getCurrentUser } from "@/lib/api";
import { clearAccessToken, getAccessToken } from "@/lib/auth";

export default function DashboardPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) { window.location.assign("/login"); return; }
    getCurrentUser().then(setUser).catch(() => {
      clearAccessToken();
      setError("Your session has expired. Please sign in again.");
    });
  }, []);

  if (error) return <main className="auth-shell"><section className="auth-card"><p className="error">{error}</p><Link href="/login">Go to login</Link></section></main>;
  if (!user) return <main className="loading">Loading your AjoCircle…</main>;
  return <main className="dashboard-shell">
    <header><div><p className="eyebrow">AjoCircle</p><h1>Hello, {user.first_name}</h1></div><button className="secondary" onClick={() => { clearAccessToken(); window.location.assign("/login"); }}>Sign out</button></header>
    <section className="dashboard-card"><h2>Your savings circles</h2><p className="muted">Group creation and your live dashboard are the next UI slice.</p></section>
  </main>;
}
