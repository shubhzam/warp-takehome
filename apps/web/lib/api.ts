import { currentSession, dropSession, setUnreachable } from "./session-store";

// every call goes through the next rewrite, so the browser stays on its own origin
const API_PREFIX = "/api";
const NETWORK_MESSAGE = "Could not reach the server, try again";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Options = { method?: Method; body?: unknown };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError(0, "UNKNOWN", message);
}

// builds ?a=1&b=2 from the values that are set, empty ones are left out
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// the api answers {"error":{"code","message"}}, anything else came from the proxy or a crash
function readErrorBody(body: unknown): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code, message };
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return undefined;
  }
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const session = currentSession();
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "No session, enter the company id, user and role first");

  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: options.method ?? "GET",
      cache: "no-store",
      headers: {
        "x-company-id": session.companyId,
        "x-user-id": session.userId,
        "x-role": session.role,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    setUnreachable(path);
    throw new ApiError(0, "NETWORK", NETWORK_MESSAGE);
  }

  const parsed = parseJson(await response.text());

  if (response.ok) {
    setUnreachable(null);
    return parsed as T;
  }

  const body = readErrorBody(parsed);
  if (!body) {
    // the rewrite answers with a bare 500 when the api is down
    setUnreachable(path);
    throw new ApiError(response.status, "NETWORK", `${NETWORK_MESSAGE} (HTTP ${response.status})`);
  }

  setUnreachable(null);
  if (response.status === 401) dropSession(`${body.code}: ${body.message}`);
  throw new ApiError(response.status, body.code, body.message);
}
