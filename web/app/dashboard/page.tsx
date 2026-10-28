"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, CurrentUser, getCurrentUser, logout } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then(setUser).catch((error) => {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError("Unable to load your account. Please try again.");
    });
  }, [router]);

  if (error) return <main className="auth-shell"><section className="auth-card"><p className="error">{error}</p><Link href="/login">Go to login</Link></section></main>;
  if (!user) return <main className="loading">Loading your AjoCircle…</main>;
  return <main className="dashboard-shell">
    <header><div><p className="eyebrow">AjoCircle</p><h1>Hello, {user.first_name}</h1></div><button className="secondary" onClick={async () => {
      try { await logout(); router.replace("/login"); }
      catch { setError("Unable to sign out. Please try again."); }
    }}>Sign out</button></header>
    <section className="dashboard-card"><h2>Your savings circles</h2><p className="muted">Group creation and your live dashboard are the next UI slice.</p></section>
  </main>;
}
