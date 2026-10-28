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
