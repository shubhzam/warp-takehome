"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "timeoff.employees";
const MAX_REMEMBERED = 8;

const NONE: string[] = [];
const listeners = new Set<() => void>();
let ids: string[] | null = null;

// storage can be blocked, then the list lives in memory for the tab
function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch (err) {
    console.warn(`recent employees: could not read storage: ${String(err)}`);
    return [];
  }
}

function snapshot(): string[] {
  if (ids === null) ids = read();
  return ids;
}

export function rememberEmployee(id: string): void {
  const current = snapshot();
  if (current[0] === id) return;
  ids = [id, ...current.filter((x) => x !== id)].slice(0, MAX_REMEMBERED);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn(`recent employees: could not write storage: ${String(err)}`);
  }
  listeners.forEach((l) => l());
}

export function useRecentEmployees(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    () => NONE,
  );
}
