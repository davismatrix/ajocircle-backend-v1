import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000/api/v1";
const COOKIE_NAME = "ajocircle_session";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/backend",
};

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  // Next.js normalizes loopback URLs to localhost. The Host header retains
  // the browser's actual destination (e.g. 127.0.0.1), needed for same-origin checks.
  const expectedOrigin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  if (request.method !== "GET" && request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ detail: "Invalid request origin" }, { status: 403 });
  }
  const { path } = await context.params;
  if (!path.length || path.some((part) => !/^[a-zA-Z0-9-]+$/.test(part))) {
    return NextResponse.json({ detail: "Invalid API path" }, { status: 400 });
  }
  const endpoint = path.join("/");
  if (endpoint === "auth/logout" && request.method === "POST") {
    const response = NextResponse.json({ authenticated: false });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
    return response;
  }
  const isSignIn = ["auth/login", "auth/register"].includes(endpoint) && request.method === "POST";
  const headers = new Headers({ Accept: "application/json" });
  if (request.method !== "GET") headers.set("Content-Type", "application/json");
  const requestKey = request.headers.get("Idempotency-Key");
  if (requestKey) headers.set("Idempotency-Key", requestKey);
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token && !isSignIn) headers.set("Authorization", `Bearer ${token}`);
  try {
    const upstream = await fetch(`${API_URL}/${endpoint}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      redirect: "error",
    });
    const body = await upstream.json();
    if (isSignIn && upstream.ok) {
      // The trusted API issues the token; only the server sees it.
      const claims = JSON.parse(Buffer.from(body.access_token.split(".")[1], "base64url").toString());
      const response = NextResponse.json({ authenticated: true }, { status: upstream.status });
      response.cookies.set(COOKIE_NAME, body.access_token, {
        ...cookieOptions,
        maxAge: Math.max(0, Math.floor(claims.exp - Date.now() / 1000)),
      });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const response = NextResponse.json(body, { status: upstream.status });
    response.headers.set("Cache-Control", "no-store");
    if (upstream.status === 401) response.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ detail: "Unable to reach the API. Please try again." }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
