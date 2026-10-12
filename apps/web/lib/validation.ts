import { ApiError } from "./api";

type Issue = { message: string; path: readonly PropertyKey[] };
type Parsed<T> = { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
type Schema<T> = { safeParse: (input: unknown) => Parsed<T> };

// same text zod's prettifyError gives, so a form says what the api would say
function dotPath(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  for (const seg of path) {
    if (typeof seg === "number") parts.push(`[${seg}]`);
    else if (typeof seg === "symbol") parts.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg)) parts.push(`[${JSON.stringify(seg)}]`);
    else {
      if (parts.length) parts.push(".");
      parts.push(seg);
    }
  }
  return parts.join("");
}

export function prettifyIssues(issues: readonly Issue[]): string {
  const lines: string[] = [];
  const sorted = [...issues].sort((a, b) => a.path.length - b.path.length);
  for (const issue of sorted) {
    lines.push(`✖ ${issue.message}`);
    if (issue.path.length) lines.push(`  → at ${dotPath(issue.path)}`);
  }
  return lines.join("\n");
}

// parses with a shared schema, a failure is thrown as the api's own validation error
export function parseOrThrow<T>(schema: Schema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(400, "VALIDATION_ERROR", prettifyIssues(result.error.issues));
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isGuid(value: string): boolean {
  return GUID.test(value);
}
