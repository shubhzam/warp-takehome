"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

const TOAST_MS = 4000;

type Toast = { id: number; message: string };
type Notify = (message: string) => void;

const ToastContext = createContext<Notify | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback<Notify>((message) => {
    const id = nextId++;
    setToasts((all) => [...all, { id, message }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): Notify {
  const notify = use(ToastContext);
  if (!notify) throw new Error("useToast needs a ToastProvider above it");
  return notify;
}
