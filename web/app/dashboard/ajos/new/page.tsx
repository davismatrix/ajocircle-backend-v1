"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AjoCreate, AjoGroup, Frequency } from "@/lib/ajo";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function CreateGroupPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    const payload: AjoCreate = {
      name: String(data.get("name")).trim(),
      description: String(data.get("description")).trim() || null,
      currency: String(data.get("currency")).trim().toUpperCase(),
      contribution_amount: String(data.get("contribution_amount")),
      frequency: data.get("frequency") as Frequency,
      payout_type: "ROTATIONAL",
      start_date: String(data.get("start_date")),
      grace_period_days: Number(data.get("grace_period_days")),
      late_fee: "0",
    };
    if (payload.name.length < 2) { setError("Enter a group name with at least two characters."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const group = await api<AjoGroup>("/ajo-groups", { method: "POST", body: JSON.stringify(payload) });
      router.replace(`/dashboard/ajos/${group.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setError(error instanceof ApiError ? error.message : "Unable to create your group. Please try again.");
      setSubmitting(false);
    }
  }

  return <>
    <Link className="back-link" href="/dashboard">← My Ajos</Link>
    <section className="dashboard-card form-card">
      <h1>Create a savings group</h1><p className="muted">Set the contribution and schedule. Your group starts as a draft.</p>
      <form onSubmit={submit} aria-busy={submitting}>
        <fieldset disabled={submitting}>
          <label>Group name<input name="name" required minLength={2} maxLength={255} autoComplete="off" /></label>
          <label><span>Description <span className="optional">(optional)</span></span><textarea name="description" rows={3} /></label>
          <div className="field-row">
            <label>Contribution per member<input name="contribution_amount" type="number" required min="0.01" step="0.01" placeholder="10000.00" inputMode="decimal" /></label>
            <label>Currency<input name="currency" required defaultValue="NGN" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" title="Three-letter currency code, such as NGN or USD" autoCapitalize="characters" /></label>
          </div>
          <div className="field-row">
            <label>Frequency<select name="frequency" defaultValue="MONTHLY"><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
            <label>Payout type<select name="payout_type" defaultValue="ROTATIONAL"><option value="ROTATIONAL">Rotational</option></select></label>
          </div>
          <p className="hint">Each member takes a turn receiving the group’s pooled contributions.</p>
          <div className="field-row">
            <label>Start date<input name="start_date" type="date" required defaultValue={today()} /></label>
            <label>Grace period (days)<input name="grace_period_days" type="number" min="0" step="1" required defaultValue="0" aria-describedby="grace-hint" /></label>
          </div>
          <p className="hint" id="grace-hint">Contributions are due this many days after each cycle starts.</p>
          <label>Late fee<input name="late_fee" value="0" readOnly aria-describedby="fee-hint" /></label>
          <p className="hint" id="fee-hint">Late fees are not available yet.</p>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button type="submit" disabled={submitting}>{submitting ? "Creating group…" : "Create draft group"}</button>
          <button className="secondary" type="button" disabled={submitting} onClick={() => router.push("/dashboard")}>Cancel</button></div>
        <span role="status" className="sr-only">{submitting ? "Creating your group. Please wait." : ""}</span>
      </form>
    </section>
  </>;
}
