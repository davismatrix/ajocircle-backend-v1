"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CurrentUser, logout } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";

import { CurrentUserContext } from "@/components/current-user";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: user, error, retry } = useResource<CurrentUser>("/auth/me");
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setLogoutError(null);
    try { await logout(); router.replace("/login"); }
    catch { setLogoutError("Unable to sign out. Please try again."); setSigningOut(false); }
  }

  if (error) return <main className="auth-shell"><section className="auth-card">
    <h1>Unable to load your account</h1><p className="error" role="alert">{error}</p>
    <button onClick={retry}>Try again</button>
  </section></main>;
  if (!user) return <main className="loading" role="status">Loading your AjoCircle…</main>;

  return <main className="dashboard-shell">
    <header className="app-header">
      <div><Link className="eyebrow brand" href="/dashboard">AjoCircle</Link><p className="muted greeting">Hello, {user.first_name}</p></div>
      <nav aria-label="Main navigation"><Link href="/dashboard">My Ajos</Link>
        <button className="secondary" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
      </nav>
    </header>
    {logoutError && <p className="error notice" role="alert">{logoutError}</p>}
    <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
  </main>;
}
