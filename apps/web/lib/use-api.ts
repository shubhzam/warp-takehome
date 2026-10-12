"use client";

import { useCallback, useEffect, useState } from "react";
import { api, toApiError, type ApiError } from "./api";
import { useSession } from "./session";

type Result<T> = { key: string; version: number; data: T | null; error: ApiError | null };

export type ApiState<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
};

// reads one path, a null path waits. refetch keeps the old data on screen until the new answer lands
export function useApi<T>(path: string | null): ApiState<T> {
  const { session } = useSession();
  const [result, setResult] = useState<Result<T> | null>(null);
  const [version, setVersion] = useState(0);

  // a different session or path is a different request, so old data never shows under it
  const key = session && path !== null ? `${session.companyId}|${session.userId}|${session.role}|${path}` : null;

  useEffect(() => {
    if (key === null || path === null) return;
    let stale = false;
    api<T>(path).then(
      (data) => {
        if (!stale) setResult({ key, version, data, error: null });
      },
      (err: unknown) => {
        if (!stale) setResult({ key, version, data: null, error: toApiError(err) });
      },
    );
    return () => {
      stale = true;
    };
  }, [key, path, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  const current = result !== null && result.key === key ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: key !== null && (current === null || current.version !== version),
    refetch,
  };
}
