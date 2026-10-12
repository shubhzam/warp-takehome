export type Role = "ADMIN" | "EMPLOYEE";
export type Session = { companyId: string; userId: string; role: Role };

export type SessionState = {
  // false until the browser has read its storage, the server render never knows the session
  loaded: boolean;
  session: Session | null;
  // the session that was dropped, so the form can show its values again
  previous: Session | null;
  // why the session was dropped, shown above the form
  notice: string | null;
  // path of the last call that could not reach the api
  unreachable: string | null;
};

const STORAGE_KEY = "timeoff.session";

const serverState: SessionState = { loaded: false, session: null, previous: null, notice: null, unreachable: null };

let state: SessionState = serverState;
const listeners = new Set<() => void>();

function emit(next: SessionState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function parseSession(value: unknown): Session | null {
  if (typeof value !== "object" || value === null) return null;
  const { companyId, userId, role } = value as Record<string, unknown>;
  if (typeof companyId !== "string" || typeof userId !== "string") return null;
  if (role !== "ADMIN" && role !== "EMPLOYEE") return null;
  return { companyId, userId, role };
}

// storage can throw in private windows or when site data is blocked, then the session lives in memory
function readStored(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseSession(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn(`session: could not read storage, using memory only: ${String(err)}`);
    return null;
  }
}

function writeStored(session: Session): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn(`session: could not write storage, keeping it in memory: ${String(err)}`);
  }
}

// first client read loads the stored session, later reads return the same object until something changes
export function getSessionState(): SessionState {
  if (!state.loaded) state = { ...state, loaded: true, session: readStored() };
  return state;
}

export function getServerSessionState(): SessionState {
  return serverState;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveSession(session: Session): void {
  writeStored(session);
  emit({ ...getSessionState(), session, previous: null, notice: null, unreachable: null });
}

// a 401 from the api: keep the stored values so a reload shows the same message, but stop using them
export function dropSession(notice: string): void {
  const current = getSessionState();
  emit({ ...current, session: null, previous: current.session ?? current.previous, notice });
}

export function setUnreachable(path: string | null): void {
  const current = getSessionState();
  if (current.unreachable === path) return;
  emit({ ...current, unreachable: path });
}

export function currentSession(): Session | null {
  return getSessionState().session;
}
