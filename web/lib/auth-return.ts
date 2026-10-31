// Restrict authentication continuation to known local flows.
export function authReturnPath(value: unknown): string {
  if (value === "/invitations/accept") return value;
  if (typeof value === "string" && value.length <= 4096
      && /^\/dashboard\/notifications(\?[^#\s\\]*)?$/.test(value)) return value;
  if (typeof value === "string" && value.length <= 4096
      && /^\/dashboard\/ajos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(contributions|cycles)(\?[^#\s\\]*)?$/i.test(value)) return value;
  return "/dashboard";
}
