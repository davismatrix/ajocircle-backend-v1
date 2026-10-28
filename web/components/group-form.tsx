"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AjoCreate, AjoGroup, Frequency, supportedCurrencies, utcToday } from "@/lib/ajo";
import { useCurrentUser } from "@/components/current-user";

type PendingCreation = { key: string; payload: AjoCreate };
function readPending(key: string): PendingCreation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value?.key && value?.payload?.name ? value : null;
  } catch { return null; }
}

export function GroupForm({ group }: { group?: AjoGroup }) {
  const router = useRouter();
  const user = useCurrentUser();
  const storageKey = `ajocircle.pending-group.${user.id}`;
  const [restored] = useState(() => group ? null : readPending(storageKey));
  const pending = useRef<PendingCreation | null>(restored);
  const values = group ?? restored?.payload;
  const [recovering, setRecovering] = useState(Boolean(restored));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function savePending(value: PendingCreation | null) {
    pending.current = value;
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The in-memory key still protects retries when browser storage is disabled. */ }
  }

  function fieldError(field: string) {
    return fieldErrors[field] ? <span className="field-error" id={`${field}-error`}>{fieldErrors[field]}</span> : null;
  }
  function accessible(field: string) {
    return { "aria-invalid": Boolean(fieldErrors[field]), "aria-describedby": fieldErrors[field] ? `${field}-error` : undefined };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    const payload: AjoCreate = recovering && pending.current ? pending.current.payload : {
      name: String(data.get("name")).trim(), description: String(data.get("description")).trim() || null,
      currency: String(data.get("currency")), contribution_amount: String(data.get("contribution_amount")),
      frequency: data.get("frequency") as Frequency, payout_type: "ROTATIONAL",
      start_date: String(data.get("start_date")), grace_period_days: Number(data.get("grace_period_days")), late_fee: "0",
    };
    if (!recovering && payload.name.length < 2) {
      setFieldErrors({ name: "Enter a group name with at least two characters." });
      event.currentTarget.elements.namedItem("name") && (event.currentTarget.elements.namedItem("name") as HTMLInputElement).focus();
      return;
    }
    setSubmitting(true); setError(null); setFieldErrors({});
    if (!group && !pending.current) savePending({ key: crypto.randomUUID(), payload });
    try {
      const saved = await api<AjoGroup>(group ? `/ajo-groups/${group.id}` : "/ajo-groups", {
        method: group ? "PATCH" : "POST", body: JSON.stringify(payload),
        headers: group ? undefined : { "Idempotency-Key": pending.current!.key },
      });
      if (!group) savePending(null);
      router.replace(`/dashboard/ajos/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      const uncertain = !group && (!(error instanceof ApiError) || error.status >= 500 || error.status === 408);
      if (!group && !uncertain) savePending(null);
      setRecovering(uncertain);
      setFieldErrors(error instanceof ApiError ? error.fieldErrors : {});
      setError(uncertain
        ? "We couldn’t confirm whether your group was created. Retry to recover the same group, or check My Ajos."
        : error instanceof ApiError ? error.message : "Unable to save your group. Please try again.");
      setSubmitting(false);
    }
  }

  return <form onSubmit={submit} aria-busy={submitting}>
    {recovering && <p className="notice" role="status">A group creation request is awaiting confirmation. Retry safely using the original settings.</p>}
    <fieldset disabled={submitting || recovering}>
      <label>Group name<input name="name" required minLength={2} maxLength={255} defaultValue={values?.name} {...accessible("name")} />{fieldError("name")}</label>
      <label><span>Description <span className="optional">(optional)</span></span><textarea name="description" rows={3} maxLength={2000} defaultValue={values?.description ?? ""} {...accessible("description")} />{fieldError("description")}</label>
      <div className="field-row">
        <label>Contribution per member<input name="contribution_amount" type="number" required min="0.01" step="0.01" placeholder="10000.00" inputMode="decimal" defaultValue={values?.contribution_amount} {...accessible("contribution_amount")} />{fieldError("contribution_amount")}</label>
        <label>Currency<select name="currency" defaultValue={values?.currency ?? "NGN"} {...accessible("currency")}>
          {group && !supportedCurrencies.includes(group.currency as typeof supportedCurrencies[number]) && <option value={group.currency} disabled>{group.currency} (choose a supported currency)</option>}
          {supportedCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </select>{fieldError("currency")}</label>
      </div>
      <div className="field-row">
        <label>Frequency<select name="frequency" defaultValue={values?.frequency ?? "MONTHLY"} {...accessible("frequency")}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select>{fieldError("frequency")}</label>
        <label>Payout type<select name="payout_type" defaultValue="ROTATIONAL"><option value="ROTATIONAL">Rotational</option></select></label>
      </div>
      <p className="hint">Each member takes a turn receiving the group’s pooled contributions.</p>
      <div className="field-row">
        <label>Start date<input name="start_date" type="date" required min={utcToday()} defaultValue={values?.start_date ?? utcToday()} {...accessible("start_date")} />{fieldError("start_date")}</label>
        <label>Grace period (days)<input name="grace_period_days" type="number" min="0" max="365" step="1" required defaultValue={values?.grace_period_days ?? 0} {...accessible("grace_period_days")} />{fieldError("grace_period_days")}</label>
      </div>
      <p className="hint">Start dates must be today or later in UTC. The grace period is 0–365 days after each cycle starts.</p>
      <label>Late fee<input name="late_fee" value="0" readOnly aria-describedby="fee-hint" /></label>
      <p className="hint" id="fee-hint">Late fees are not available yet.</p>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      <button type="submit" disabled={submitting}>{submitting ? (group ? "Saving…" : "Creating group…") : recovering ? "Retry group creation" : group ? "Save changes" : "Create draft group"}</button>
      <button className="secondary" type="button" disabled={submitting} onClick={() => router.push(group ? `/dashboard/ajos/${group.id}` : "/dashboard")}>{recovering ? "Check My Ajos" : "Cancel"}</button>
    </div>
    <span role="status" className="sr-only">{submitting ? "Saving your group. Please wait." : ""}</span>
  </form>;
}
