export type Change = { path: string; before: unknown; after: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// every leaf of a json value keyed by its path, so two values can be compared leaf by leaf
function leaves(value: unknown, path: string, into: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) into.set(path || "(root)", value);
    for (const key of keys) leaves(value[key], path ? `${path}.${key}` : key, into);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) into.set(path || "(root)", value);
    value.forEach((item, i) => leaves(item, `${path}[${i}]`, into));
    return;
  }
  into.set(path || "(root)", value);
}

// the leaves that differ between before and after, a missing side shows as undefined
export function diffJson(before: unknown, after: unknown): Change[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  if (before !== null && before !== undefined) leaves(before, "", left);
  if (after !== null && after !== undefined) leaves(after, "", right);

  const paths = [...new Set([...left.keys(), ...right.keys()])];
  const changes: Change[] = [];
  for (const path of paths) {
    const a = left.get(path);
    const b = right.get(path);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path, before: a, after: b });
  }
  return changes;
}

export function showValue(value: unknown): string {
  if (value === undefined) return "-";
  return typeof value === "string" ? value : JSON.stringify(value);
}
