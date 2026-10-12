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

export type WorkedAccrualDetail = {
  source: "PAYROLL";
  hoursWorked: string;
  activeDays: number;
  segments: { versionNo: number; days: number; earnHours: string; perHoursWorked: string }[];
};

type WorkedAccrualInput = {
  periodStart: string;
  periodEnd: string;
  hoursWorked: string;
  assignmentFrom: string;
  assignmentTo: string | null;
  versions: AccrualVersion[];
};

// pay period accrual: the hours worked are spread evenly over the days the assignment is active in the period
// and each day earns at the rate of the version in force that day, so a joiner or leaver keeps all their hours
export function computeWorkedAccrual(input: WorkedAccrualInput): { hours: Decimal; detail: WorkedAccrualDetail } {
  const start = dayNumber(input.periodStart);
  const end = dayNumber(input.periodEnd) + 1;

  // days the assignment is active inside the period, the assignment end date is exclusive like in the database
  const from = Math.max(start, dayNumber(input.assignmentFrom));
  const to = Math.min(end, input.assignmentTo ? dayNumber(input.assignmentTo) : end);
  const activeDays = Math.max(0, to - from);

  const sorted = [...input.versions].sort(
    (a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.versionNo - b.versionNo,
  );

  // sum of (days x rate) over the versions, rate is hours earned per hour worked
  let weightedRate = new Decimal(0);
  const segments: WorkedAccrualDetail["segments"] = [];
  for (const [i, version] of sorted.entries()) {
    const next = sorted[i + 1];
    const versionFrom = dayNumber(version.effectiveFrom);
    const versionTo = next ? dayNumber(next.effectiveFrom) : end;
    const days = Math.max(0, Math.min(versionTo, to) - Math.max(versionFrom, from));
    if (days === 0) continue;

    // only hours worked versions earn here, a zero perHoursWorked earns nothing instead of dividing by zero
    const accrual = version.config.accrual;
    const earns = accrual.kind === "HOURS_WORKED" && !new Decimal(accrual.perHoursWorked).isZero();
    const earnHours = earns && accrual.kind === "HOURS_WORKED" ? accrual.earnHours : "0";
    const perHoursWorked = earns && accrual.kind === "HOURS_WORKED" ? accrual.perHoursWorked : "0";
    if (earns) weightedRate = weightedRate.plus(new Decimal(earnHours).div(perHoursWorked).times(days));
    segments.push({ versionNo: version.versionNo, days, earnHours, perHoursWorked });
  }

  const detail: WorkedAccrualDetail = { source: "PAYROLL", hoursWorked: input.hoursWorked, activeDays, segments };
  if (activeDays === 0) return { hours: new Decimal(0), detail };

  // rates like 1/30 are not exact, so round to 12 places first, that keeps a true half (3.65625) a half
  // then round once to 4 places, half up
  const hours = new Decimal(input.hoursWorked)
    .times(weightedRate)
    .div(activeDays)
    .toDecimalPlaces(12)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return { hours, detail };
}