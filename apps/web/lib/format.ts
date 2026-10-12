import type { TimeOffType } from "./types";

export const TYPE_LABELS: Record<TimeOffType, string> = {
  VACATION: "Vacation",
  SICK: "Sick",
  PARENTAL: "Parental",
};

// the brief calls vacation PTO in its summary bar
export const TYPE_SHORT: Record<TimeOffType, string> = {
  VACATION: "PTO",
  SICK: "sick",
  PARENTAL: "parental",
};

export const TYPE_ORDER: TimeOffType[] = ["VACATION", "SICK", "PARENTAL"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// the api counts dates in utc, so the console does too
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// iso weekday of a plain date, 1 is Monday and 7 is Sunday
export function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[isoWeekday(iso) - 1] ?? "";
}

export function weekdayName(day: number): string {
  return WEEKDAYS[day - 1] ?? String(day);
}

// 1,2,3,4,5 reads "Mon to Fri", anything else lists the days
export function workDaysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "no days";
  const contiguous = sorted.length > 1 && last - first === sorted.length - 1;
  if (contiguous) return `${weekdayName(first)} to ${weekdayName(last)}`;
  return sorted.map(weekdayName).join(", ");
}

// "16.0000" reads "16", "7.5000" reads "7.5", the string is trimmed and never goes through a float
export function trimHours(hours: string): string {
  if (!hours.includes(".")) return hours;
  return hours.replace(/0+$/, "").replace(/\.$/, "");
}

export function hoursLabel(hours: string): string {
  return `${trimHours(hours)}h`;
}

export function hoursWord(hours: string): string {
  const trimmed = trimHours(hours);
  return `${trimmed} ${trimmed === "1" ? "hour" : "hours"}`;
}

// days are only a hint at the employee's day length, hours stay the unit
export function daysHint(hours: string, dayLength: number | null): string | null {
  if (dayLength === null || dayLength <= 0) return null;
  const days = Math.round((Number(hours) / dayLength) * 10) / 10;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// whole hours and minutes become one total in 4 decimals, minutes are integers so 20 minutes is "0.3333"
export function hoursFromParts(hours: number, minutes: number): string {
  return ((hours * 60 + minutes) / 60).toFixed(4);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}...` : id;
}
