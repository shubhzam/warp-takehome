import { Decimal } from "decimal.js";
import { formatDate, parseDate } from "./dates";

const DAY_MS = 86_400_000;
const ZERO_HOURS = "0.0000";

export type WorkPattern = {
  hoursPerDay: string;
  // iso weekdays, 1 is monday and 7 is sunday
  workDays: number[];
  calendarId: string | null;
};

export type ScheduleRow = WorkPattern & { effectiveFrom: string };

// what an employee works until an admin sets a schedule, the company default calendar applies
export const standardSchedule: WorkPattern = { hoursPerDay: "8", workDays: [1, 2, 3, 4, 5], calendarId: null };

export type DayKind = "WORKDAY" | "HOLIDAY" | "NON_WORKDAY";

// hours is the cost of the day, zero unless it is a workday, holidayName is only there on holidays
export type PricedDay = { date: string; kind: DayKind; hours: string; holidayName?: string };

export type PriceInput = {
  startDate: string;
  endDate: string;
  // every schedule row of the employee, in any order, rows after endDate are ignored
  schedules: ScheduleRow[];
  // calendar id to date to holiday name
  holidaysByCalendar: Map<string, Map<string, string>>;
  defaultCalendarId: string | null;
};

// 1 is monday and 7 is sunday, read on the utc date so no time zone can move a day
const isoWeekday = (date: string): number => parseDate(date).getUTCDay() || 7;

function priceDay(date: string, pattern: WorkPattern, input: PriceInput): PricedDay {
  if (!pattern.workDays.includes(isoWeekday(date))) return { date, kind: "NON_WORKDAY", hours: ZERO_HOURS };

  // a schedule without a calendar falls back to the company default, which may not exist
  const calendarId = pattern.calendarId ?? input.defaultCalendarId;
  const holidayName = calendarId ? input.holidaysByCalendar.get(calendarId)?.get(date) : undefined;
  if (holidayName !== undefined) return { date, kind: "HOLIDAY", hours: ZERO_HOURS, holidayName };

  return { date, kind: "WORKDAY", hours: new Decimal(pattern.hoursPerDay).toFixed(4) };
}

// prices every calendar date of the range, no database access so it can be checked on its own
export function priceRange(input: PriceInput): { hours: Decimal; days: PricedDay[] } {
  // newest first, so the first row on or before a date is the one in force that day
  const newestFirst = [...input.schedules].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  const days: PricedDay[] = [];
  let total = new Decimal(0);
  const end = parseDate(input.endDate).getTime();
  for (let t = parseDate(input.startDate).getTime(); t <= end; t += DAY_MS) {
    const date = formatDate(new Date(t));
    const pattern = newestFirst.find((s) => s.effectiveFrom <= date) ?? standardSchedule;
    const day = priceDay(date, pattern, input);
    days.push(day);
    total = total.plus(day.hours);
  }
  return { hours: total, days };
}
