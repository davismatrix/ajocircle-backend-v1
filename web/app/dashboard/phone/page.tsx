"use client";

import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/hooks/use-resource";
import { CurrentUser } from "@/lib/api";
import { PhoneVerificationForm } from "@/components/phone-verification-form";

export default function PhonePage() {
  const { data: account, error, retry } = useResource<CurrentUser>("/auth/me");
  const [changing, setChanging] = useState(false);
  const [updated, setUpdated] = useState<CurrentUser | null>(null);
  const user = updated ?? account;
  return <><Link className="back-link" href="/dashboard">← My Ajos</Link><section className="dashboard-card form-card">
    <h1>Phone verification</h1>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={retry}>Try again</button></>
      : !user ? <p role="status">Loading your account…</p>
      : <><p>{user.phone_verified ? `Verified phone: ${user.phone_number}` : "Your phone number is not verified."}</p>
        {user.phone_verified ? <details onToggle={(event) => setChanging(event.currentTarget.open)}><summary>Verify a different number</summary>{changing && <PhoneVerificationForm user={user} onVerified={(verified) => setUpdated(verified)} />}</details>
          : <PhoneVerificationForm user={user} onVerified={(verified) => setUpdated(verified)} />}</>}
  </section></>;
}
