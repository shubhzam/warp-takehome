"use client";

import { createContext, use, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  getServerSessionState,
  getSessionState,
  saveSession,
  subscribeSession,
  type Session,
  type SessionState,
} from "./session-store";

type SessionContextValue = SessionState & { signIn: (session: Session) => void };

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSession, getSessionState, getServerSessionState);
  const value = useMemo(() => ({ ...state, signIn: saveSession }), [state]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession needs a SessionProvider above it");
  return value;
}
