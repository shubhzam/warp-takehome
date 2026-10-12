import type { PolicyConfig } from "@repo/shared/policy";
import { Decimal } from "decimal.js";

const DAY_MS = 86_400_000;

// days since 1970-01-01 for a YYYY-MM-DD string, in utc so daylight saving never shifts a day
const dayNumber = (iso: string): number =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

const toIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

// start is the first day, endExclusive the first day of the next month, lastDay the date an accrual is booked on
export function periodBounds(period: string) {
  const start = dayNumber(`${period}-01`);
  const endExclusive = Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1) / DAY_MS;
  return {
    start: toIso(start),
    endExclusive: toIso(endExclusive),
    lastDay: toIso(endExclusive - 1),
    days: endExclusive - start,
  };
}

export type AccrualVersion = { versionNo: number; effectiveFrom: string; config: PolicyConfig };

export type AccrualDetail = {
  daysInPeriod: number;
  segments: { versionNo: number; days: number; monthlyHours: string }[];
};

type AccrualInput = {
  period: string;
  assignmentFrom: string;
  assignmentTo: string | null;
  versions: AccrualVersion[];
};

export function computeAccrual(input: AccrualInput): { hours: Decimal; detail: AccrualDetail } {
  const bounds = periodBounds(input.period);
  const start = dayNumber(bounds.start);
  const end = dayNumber(bounds.endExclusive);

  // days the assignment is active inside the period, the end date is exclusive like in the database
  const from = Math.max(start, dayNumber(input.assignmentFrom));
  const to = Math.min(end, input.assignmentTo ? dayNumber(input.assignmentTo) : end);

  // a version covers the days from its start until the next version starts, same date ties go to the higher version_no
  const sorted = [...input.versions].sort(
    (a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.versionNo - b.versionNo,
  );

  let weighted = new Decimal(0);
  const segments: AccrualDetail["segments"] = [];
  for (const [i, version] of sorted.entries()) {
    const next = sorted[i + 1];
    const versionFrom = dayNumber(version.effectiveFrom);
    const versionTo = next ? dayNumber(next.effectiveFrom) : end;
    const days = Math.max(0, Math.min(versionTo, to) - Math.max(versionFrom, from));
    if (days === 0) continue;

    // only time based policies earn here, unlimited and hours worked earn nothing in this feature
    const monthlyHours = version.config.accrual.kind === "TIME" ? version.config.accrual.hoursPerMonth : "0";
    weighted = weighted.plus(new Decimal(monthlyHours).times(days));
    segments.push({ versionNo: version.versionNo, days, monthlyHours });
  }

  // divide once at the end and round once, half up to 4 decimals
  const hours = weighted.div(bounds.days).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return { hours, detail: { daysInPeriod: bounds.days, segments } };
}