const API_URL = "/api/backend";

export type SessionResponse = { authenticated: boolean };
export type CurrentUser = { id: string; first_name: string; last_name: string; email: string; phone_number: string | null; role: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Remove credentials left by the previous browser-storage session implementation.
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem("ajocircle.access_token"); }
    catch { /* Browser storage may be disabled; sessions use cookies. */ }
  }
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).join(", ")
      : detail || "Something went wrong. Please try again.";
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function register(payload: { first_name: string; last_name: string; email: string; phone_number?: string; password: string }) {
  return api<SessionResponse>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }) {
  return api<SessionResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
}

export function getCurrentUser() {
  return api<CurrentUser>("/auth/me");
}

export function logout() {
  return api<SessionResponse>("/auth/logout", { method: "POST" });
}
