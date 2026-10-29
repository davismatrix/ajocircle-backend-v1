// Matches AjoResponse, MyAjoResponse, and AjoCreate in app/schemas/ajo.py.
// Pydantic serializes Decimal responses as strings; preserve them in requests too.
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";
export type GroupRole = "OWNER" | "ADMIN" | "TREASURER" | "MEMBER";
export type AjoGroup = {
  id: string;
  name: string;
  description: string | null;
  grace_period_days: number;
  late_fee: string;
  currency: string;
  contribution_amount: string;
  frequency: Frequency;
  payout_type: "ROTATIONAL";
  start_date: string;
  status: string;
  created_by: string;
};
export type MyAjo = AjoGroup & { membership_role: GroupRole; payout_position: number | null };
export type AjoCreate = {
  name: string;
  description: string | null;
  currency: string;
  contribution_amount: string;
  frequency: Frequency;
  payout_type: "ROTATIONAL";
  start_date: string;
  grace_period_days: number;
  late_fee: "0";
};

export const frequencyLabels: Record<Frequency, string> = {
  DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly",
};

export function formatAmount(amount: string, currency: string) {
  // Format the integer and fractional parts separately to avoid losing cents on large amounts.
  const [integer, fraction = ""] = amount.split(".");
  return `${currency} ${BigInt(integer).toLocaleString("en-CA")}.${fraction.padEnd(2, "0")}`;
}

export function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export const supportedCurrencies = ["NGN", "USD", "CAD", "GBP", "EUR"] as const;

export function utcToday() { return new Date().toISOString().slice(0, 10); }

export type Membership = { id: string; user_id: string; role: GroupRole; payout_position: number | null; status: string };
export type Member = Membership & { first_name: string; last_name: string; email: string; phone_number: string | null };
export type DashboardContribution = { schedule_id: string; due_date: string; expected_amount: string; status: string };
export type DashboardCycle = { cycle_id: string; cycle_number: number; period_start: string; period_end: string; status: string; expected_amount: string };
export type DashboardActivity = { action: string; entity_type: string; entity_id: string | null; created_at: string };
export type GroupDashboard = { group: AjoGroup; membership: Membership; next_contribution: DashboardContribution | null; current_cycle: DashboardCycle | null; recent_activity: DashboardActivity[] };
export type PendingContribution = { contribution_id: string; member_id: string; first_name: string; last_name: string; cycle_number: number; due_date: string; paid_amount: string; payment_method: string | null; payment_reference: string | null };
export type PendingContributions = { items: PendingContribution[]; page: number; page_size: number; total: number };
