import { createRequestBody } from "@repo/shared/requests";
import { previewQuery, setHolidaysBody, setWorkScheduleBody } from "@repo/shared/schedule";
import { type PriceInput, type ScheduleRow, priceRange } from "../src/lib/schedule";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
  }
}

const US = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

// the company A calendar from the definition of done
const holidays = new Map<string, Map<string, string>>([
  [
    US,
    new Map([
      ["2026-11-26", "Thanksgiving"],
      ["2026-11-27", "Day after Thanksgiving"],
      ["2026-12-25", "Christmas"],
    ]),
  ],
]);

const schedule = (effectiveFrom: string, hoursPerDay: string, workDays: number[], calendarId: string | null = null): ScheduleRow => ({
  effectiveFrom,
  hoursPerDay,
  workDays,
  calendarId,
});

// defaults to the US calendar being the company default and the employee having no schedule row
function price(startDate: string, endDate: string, over: Partial<PriceInput> = {}) {
  const result = priceRange({
    startDate,
    endDate,
    schedules: [],
    holidaysByCalendar: holidays,
    defaultCalendarId: US,
    ...over,
  });
  return { hours: result.hours.toFixed(4), days: result.days };
}

const kinds = (days: { kind: string }[]) => days.map((d) => d.kind);
const weekdays = [1, 2, 3, 4, 5];

// definition of done steps 1 and 2, the week of thanksgiving
const standard = price("2026-11-23", "2026-11-27");
check("standard week with two holidays", standard.hours, "24.0000");
check("standard week kinds", kinds(standard.days), ["WORKDAY", "WORKDAY", "WORKDAY", "HOLIDAY", "HOLIDAY"]);
check("standard week holiday names", standard.days.filter((d) => d.holidayName).map((d) => [d.date, d.holidayName]), [
  ["2026-11-26", "Thanksgiving"],
  ["2026-11-27", "Day after Thanksgiving"],
]);
check("standard week day costs", standard.days.map((d) => d.hours), ["8.0000", "8.0000", "8.0000", "0.0000", "0.0000"]);
check("workdays carry no holiday name", standard.days[0], { date: "2026-11-23", kind: "WORKDAY", hours: "8.0000" });

check("6 hour days", price("2026-11-23", "2026-11-27", { schedules: [schedule("2026-01-01", "6", weekdays)] }).hours, "18.0000");

const fourByTen = price("2026-11-23", "2026-11-27", { schedules: [schedule("2026-01-01", "10", [1, 2, 3, 4])] });
check("monday to thursday 10 hour week", fourByTen.hours, "30.0000");
check("four by ten kinds", kinds(fourByTen.days), ["WORKDAY", "WORKDAY", "WORKDAY", "HOLIDAY", "NON_WORKDAY"]);

// step 6, 8 hours until the 30th, 6 hours from december 1st
const change = price("2026-11-30", "2026-12-02", { schedules: [schedule("2026-12-01", "6", weekdays)] });
check("schedule change mid range", change.hours, "20.0000");
check("schedule change day costs", change.days.map((d) => d.hours), ["8.0000", "6.0000", "6.0000"]);

// nothing to price
const weekend = price("2026-11-28", "2026-11-29");
check("weekend only range", weekend.hours, "0.0000");
check("weekend only kinds", kinds(weekend.days), ["NON_WORKDAY", "NON_WORKDAY"]);
const christmas = price("2026-12-25", "2026-12-25");
check("holiday only range", christmas.hours, "0.0000");
check("holiday only kind", christmas.days, [{ date: "2026-12-25", kind: "HOLIDAY", hours: "0.0000", holidayName: "Christmas" }]);

// weekdays are iso numbers, 6 is saturday and 7 is sunday
const saturdayWorker = price("2026-11-28", "2026-11-29", { schedules: [schedule("2026-01-01", "8", [1, 2, 3, 4, 5, 6])] });
check("saturday worker prices saturday", saturdayWorker.hours, "8.0000");
check("saturday worker kinds", kinds(saturdayWorker.days), ["WORKDAY", "NON_WORKDAY"]);
const sundayWorker = price("2026-11-29", "2026-11-29", { schedules: [schedule("2026-01-01", "5", [7])] });
check("sunday worker prices sunday", sundayWorker.hours, "5.0000");

// a holiday on a day the employee does not work costs nothing either way, and is reported as a non workday
const saturdayHoliday = new Map([[US, new Map([["2026-11-28", "Saturday closure"]])]]);
const closureStandard = price("2026-11-28", "2026-11-28", { holidaysByCalendar: saturdayHoliday });
check("holiday on a non working weekday", closureStandard.days, [{ date: "2026-11-28", kind: "NON_WORKDAY", hours: "0.0000" }]);
const closureSaturday = price("2026-11-28", "2026-11-28", {
  holidaysByCalendar: saturdayHoliday,
  schedules: [schedule("2026-01-01", "8", [1, 2, 3, 4, 5, 6])],
});
check("same holiday on a working saturday", closureSaturday.days[0]?.kind, "HOLIDAY");

// calendars
const named = price("2026-11-23", "2026-11-27", {
  schedules: [schedule("2026-01-01", "8", weekdays, OTHER)],
  holidaysByCalendar: new Map([[OTHER, new Map([["2026-11-25", "Company day off"]])]]),
});
check("a schedule calendar replaces the default one", named.hours, "32.0000");
check("the named calendar holiday", named.days.filter((d) => d.kind === "HOLIDAY").map((d) => d.holidayName), ["Company day off"]);
check("no default calendar and no schedule", price("2026-11-23", "2026-11-27", { defaultCalendarId: null }).hours, "40.0000");
check("schedule without calendar uses the default", price("2026-11-23", "2026-11-27", { schedules: [schedule("2026-01-01", "6", weekdays)] }).days[3]?.kind, "HOLIDAY");

// schedule selection
check("7.5 hour days", price("2026-11-23", "2026-11-25", { schedules: [schedule("2026-01-01", "7.5", weekdays)] }).hours, "22.5000");
check("a schedule starting after the range is ignored", price("2026-11-23", "2026-11-25", { schedules: [schedule("2027-01-01", "4", weekdays)] }).hours, "24.0000");
check("a schedule starting on the first day applies", price("2026-11-23", "2026-11-23", { schedules: [schedule("2026-11-23", "4", weekdays)] }).hours, "4.0000");
check(
  "the latest row on or before the day wins, in any input order",
  price("2026-11-23", "2026-11-25", {
    schedules: [schedule("2026-11-24", "2", weekdays), schedule("2026-01-01", "6", weekdays), schedule("2026-11-25", "1", weekdays)],
  }).days.map((d) => d.hours),
  ["6.0000", "2.0000", "1.0000"],
);
check("one day range", price("2026-11-23", "2026-11-23").hours, "8.0000");
check("a year range counts every date", price("2026-01-01", "2026-12-31").days.length, 365);

// shared schemas
const base = { employeeId: "emp_1", type: "VACATION", startDate: "2026-11-23", endDate: "2026-11-27", idempotencyKey: "k1" };
check("request without hours is valid", createRequestBody.safeParse(base).success, true);
check("request with hours is valid", createRequestBody.safeParse({ ...base, hours: "12" }).success, true);
check("request with zero hours is not", createRequestBody.safeParse({ ...base, hours: "0" }).success, false);

const body = { effectiveFrom: "2026-12-01", hoursPerDay: "6", workDays: weekdays };
check("schedule body is valid", setWorkScheduleBody.safeParse(body).success, true);
check("7.5 hours per day is valid", setWorkScheduleBody.safeParse({ ...body, hoursPerDay: "7.5" }).success, true);
check("24 hours per day is valid", setWorkScheduleBody.safeParse({ ...body, hoursPerDay: "24" }).success, true);
check("0 hours per day is not", setWorkScheduleBody.safeParse({ ...body, hoursPerDay: "0" }).success, false);
check("24.0001 hours per day is not", setWorkScheduleBody.safeParse({ ...body, hoursPerDay: "24.0001" }).success, false);
check("work day 8 is not", setWorkScheduleBody.safeParse({ ...body, workDays: [1, 8] }).success, false);
check("repeated work day is not", setWorkScheduleBody.safeParse({ ...body, workDays: [1, 1] }).success, false);
check("no work days is not", setWorkScheduleBody.safeParse({ ...body, workDays: [] }).success, false);

check("holiday dates must be unique", setHolidaysBody.safeParse({ holidays: [{ date: "2026-12-25", name: "a" }, { date: "2026-12-25", name: "b" }] }).success, false);
check("holiday list is valid", setHolidaysBody.safeParse({ holidays: [{ date: "2026-12-25", name: "Christmas" }] }).success, true);

const q = { employeeId: "emp_1", startDate: "2026-01-01" };
// both ends count, so 2026-01-01 to 2027-01-01 is 366 days
check("a 366 day preview is valid", previewQuery.safeParse({ ...q, endDate: "2027-01-01" }).success, true);
check("a 367 day preview is not", previewQuery.safeParse({ ...q, endDate: "2027-01-02" }).success, false);
check("start after end is not", previewQuery.safeParse({ employeeId: "emp_1", startDate: "2026-02-01", endDate: "2026-01-01" }).success, false);

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log("\nall checks passed");
