"use client";

import type { ReactNode } from "react";
import type { ApiError } from "../lib/api";
import type { ApiState } from "../lib/use-api";

// shows the api's code and message exactly as they came
export function ErrorNote({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="note note-danger" role="alert">
      <div className="note-text">
        <strong className="code">{error.code}</strong>
        <span className="message">{error.message}</span>
      </div>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Tag({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "danger" | "accent"; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// loading and failure of one read in one place, the children only see data
export function AsyncView<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  if (state.data === null) {
    if (state.error) return <ErrorNote error={state.error} onRetry={state.refetch} />;
    return <p className="muted">Loading...</p>;
  }
  return (
    <>
      {state.error ? <ErrorNote error={state.error} onRetry={state.refetch} /> : null}
      {children(state.data)}
    </>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
