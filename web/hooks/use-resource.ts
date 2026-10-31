"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { authReturnPath } from "@/lib/auth-return";

type Result<T> = { path: string; data: T | null; error: string | null };

export function useResource<T>(path: string) {
  const router = useRouter();
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const retry = useCallback(() => { setResult(null); setAttempt((value) => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setResult({ path, data, error: null });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        const next = authReturnPath(window.location.pathname + window.location.search);
        router.replace(next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setResult({ path, data: null, error: error instanceof ApiError ? error.message : "Unable to connect. Please try again." });
    });
    return () => controller.abort();
  }, [path, attempt, router]);

  const current = result?.path === path ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current, retry, refresh };
}
