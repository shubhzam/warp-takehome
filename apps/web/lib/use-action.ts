"use client";

import { useCallback, useState } from "react";
import { toApiError, type ApiError } from "./api";

// wraps one write: pending while it runs, the api's error kept as it came. run answers true on success
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(async (task: () => Promise<void>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (err) {
      setError(toApiError(err));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}
