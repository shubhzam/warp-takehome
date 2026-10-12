# work-hours-and-holidays: techspec

## Version targets

Checked 2026-10-12. No new packages. Node 24, TypeScript 7.0.2, Express 5.3.0, zod ^4.6, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18, decimal.js 10.6.0, uuidv7 1.2.1.

## Problem statement

Prices a time off request from the employee's work schedule and holiday calendar instead of trusting a number from the caller, and records how the price was reached. Spending and the ledger do not change.

## Requirements

- Auth, ids, dates, hours, error shape and audit rules are the same as the earlier features. Every write is one transaction with its audit row. Calendars, holidays and schedules need ADMIN. Preview and submit work for both roles as today.
- A request's price is computed once at submit and stored. Nothing recomputes it.
- Dates are plain `YYYY-MM-DD`. Weekdays are ISO numbers, 1 is Monday and 7 is Sunday. A holiday and a working weekday are matched on the calendar date, no time zones.
- A balance row always equals the sum of its ledger entries. This feature writes no ledger entry.

## API contract

| Endpoint | Body | Success | Specific errors |
|---|---|---|---|
| POST /holiday-calendars | `{name, isDefault?}` | 201 calendar | 409 DUPLICATE_NAME, 409 DEFAULT_EXISTS |
| GET /holiday-calendars | | 200 `[{id, name, isDefault, holidayCount}]` | |
| GET /holiday-calendars/:id?year= | | 200 `{calendar, holidays: [{date, name}]}`, all dates or one year | 404 NOT_FOUND |
| PUT /holiday-calendars/:id/holidays | `{holidays: [{date, name}]}`, 1 to 100 | 200 `{added, updated, unchanged}` | 404 NOT_FOUND |
| DELETE /holiday-calendars/:id/holidays/:date | | 200 `{date, name}` of the removed holiday | 404 NOT_FOUND |
| PUT /employees/:employeeId/work-schedule | `{effectiveFrom, hoursPerDay, workDays, calendarId?}` | 200 schedule | 404 NOT_FOUND (calendar) |
| GET /employees/:employeeId/work-schedule?asOf= | | 200 `{inForce, history[]}` | |
| GET /requests/preview?employeeId=&startDate=&endDate= | | 200 `{employeeId, startDate, endDate, hours, days[]}` | 403 FORBIDDEN (employee for someone else) |
| POST /requests | `hours` is now optional | as before | 422 NO_WORKING_DAYS, 422 HOURS_TOO_LARGE |

A day in `days` is `{date, kind, hours, holidayName?}`, where `kind` is `WORKDAY`, `HOLIDAY` or `NON_WORKDAY`, and `hours` is the cost of that day (0 unless `WORKDAY`). `hours` of the preview is their sum, a 4 decimal string. A schedule is `{id, employeeId, effectiveFrom, hoursPerDay, workDays, calendarId, source}`. `source` is `SCHEDULE` or `STANDARD` (the fallback, with `id` null). The route `/requests/preview` is registered before `/requests/:id`. The range of a preview or a submit is at most 366 days.

Shared schemas, in `packages/shared/src/schedule.ts`, exported as `./schedule`:

```ts
import { z } from "zod";

const isoDate = z.iso.date();
const hoursPerDay = z.string().regex(/^(?!0+(\.0+)?$)\d{1,2}(\.\d{1,4})?$/).refine((h) => Number(h) <= 24, {
  message: "hoursPerDay must be at most 24",
});

export const createCalendarBody = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional(),
});

export const setHolidaysBody = z
  .object({
    holidays: z.array(z.object({ date: isoDate, name: z.string().trim().min(1).max(100) })).min(1).max(100),
  })
  .refine((b) => new Set(b.holidays.map((h) => h.date)).size === b.holidays.length, {
    message: "dates must be unique",
  });

export const setWorkScheduleBody = z.object({
  effectiveFrom: isoDate,
  hoursPerDay,
  // iso weekdays, 1 is monday and 7 is sunday, no repeats
  workDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, { message: "workDays must not repeat" }),
  calendarId: z.guid().nullable().optional(),
});

export const previewQuery = z
  .object({ employeeId: z.string().min(1), startDate: isoDate, endDate: isoDate })
  .refine((q) => q.startDate <= q.endDate, { message: "startDate must not be after endDate" })
  .refine((q) => (Date.parse(q.endDate) - Date.parse(q.startDate)) / 86_400_000 < 366, {
    message: "a request spans at most 366 days",
  });
```

In `packages/shared/src/requests.ts`, `hours` of `createRequestBody` becomes `positiveHours.optional()`.

## Pricing rule

For each calendar date from `startDate` to `endDate`:

1. Schedule in force that day: the row of that employee with the latest `effective_from` on or before the date. None: the standard schedule (8 hours, weekdays 1 to 5, calendar null).
2. The calendar of that schedule, or the company's default calendar when it names none, or no calendar when there is no default.
3. Kind: weekday not in `workDays` is `NON_WORKDAY`. Otherwise a date in the calendar is `HOLIDAY` with its name. Otherwise `WORKDAY` costing `hoursPerDay`.

The total is the sum of the `WORKDAY` costs in decimal.js. A pure function `priceRange({startDate, endDate, schedules, holidaysByCalendar, defaultCalendarId})` in `lib/schedule.ts` does this and returns `{hours, days}`. It does no database access, so it can be checked on its own.

## Submit rule

Changes to the submit rule of `createRequest`:

1. After the assignment check, load the employee's schedules up to `endDate`, the default calendar, and the holidays of every calendar involved inside the range. Price the range inside the same transaction.
2. Total is 0: 422 NO_WORKING_DAYS with the range in the message.
3. `hours` omitted: the request's hours are the total, `source` is `COMPUTED`.
4. `hours` given: it must not exceed the total, else 422 HOURS_TOO_LARGE with both numbers. `source` is `GIVEN`. The old 24 hours a day cap is gone, the schedule is the cap.
5. Store `computation` on the request: `{source, scheduledHours, days}`, where `days` is the breakdown above.
6. Replay: the existing idempotency lookup stays. When `hours` was omitted, the replay check compares employee, type and dates only, because a schedule change in between would make the recomputed total differ.

Approve and cancel are untouched, they use the stored `hours`.

## Schedule and holiday writes

- Create calendar: insert, audit `HOLIDAY_CALENDAR_CREATED`. `isDefault` true while another default exists fails on the partial unique index: 409 DEFAULT_EXISTS. A name that exists: 409 DUPLICATE_NAME.
- Set holidays: one transaction, upsert each `(calendarId, date)`. Same name again counts as `unchanged` and writes no audit. A new date is `added`, a changed name is `updated`. One audit row `HOLIDAY_SET` per added or updated holiday, entity `holiday_calendar`, `before` and `after` as `{date, name}`.
- Remove holiday: delete the row, audit `HOLIDAY_REMOVED` with `before`. Missing: 404.
- Set schedule: upsert on `(company, employee, effectiveFrom)`. A named `calendarId` must belong to the company: 404 NOT_FOUND. Same values again write nothing. Otherwise audit `WORK_SCHEDULE_SET` with entity `work_schedule` (the schedule row id), `before` null on first set. Any effective date is accepted.
- Get schedule: `inForce` is the schedule on `asOf` (today by default) or the standard one, `history` is every row newest first.

## Schema

No existing model gets a relation. Append these models, and add the one column to `TimeOffRequest` below:

```prisma
model HolidayCalendar {
  id        String    @id @db.Uuid
  companyId String    @map("company_id") @db.Uuid
  name      String
  isDefault Boolean   @default(false) @map("is_default")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  holidays  Holiday[]

  @@unique([companyId, name])
  @@map("holiday_calendars")
}

model Holiday {
  calendarId String          @map("calendar_id") @db.Uuid
  date       DateTime        @db.Date
  name       String
  createdAt  DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime        @updatedAt @map("updated_at") @db.Timestamptz(3)
  calendar   HolidayCalendar @relation(fields: [calendarId], references: [id], onDelete: Cascade)

  @@id([calendarId, date])
  @@map("holidays")
}

model EmployeeWorkSchedule {
  id            String   @id @db.Uuid
  companyId     String   @map("company_id") @db.Uuid
  employeeId    String   @map("employee_id")
  effectiveFrom DateTime @map("effective_from") @db.Date
  hoursPerDay   Decimal  @map("hours_per_day") @db.Decimal(6, 4)
  workDays      Int[]    @map("work_days")
  calendarId    String?  @map("calendar_id") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([companyId, employeeId, effectiveFrom])
  @@map("employee_work_schedules")
}
```

In `TimeOffRequest` add `computation Json?`. Migration name `work_schedules`, created with `--create-only`, then append:

```sql
-- one default calendar per company
CREATE UNIQUE INDEX holiday_calendars_one_default ON holiday_calendars (company_id) WHERE is_default;

-- a schedule is a real working day pattern
ALTER TABLE employee_work_schedules ADD CONSTRAINT work_schedules_hours_valid
  CHECK (hours_per_day > 0 AND hours_per_day <= 24);
ALTER TABLE employee_work_schedules ADD CONSTRAINT work_schedules_days_valid
  CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1,2,3,4,5,6,7]);
```

The unique `(company_id, employee_id, effective_from)` index serves C1 (read it descending). The primary key of `holidays` serves C2 and C4.

## Changes to existing code

- `lib/audit.ts`: actions `HOLIDAY_CALENDAR_CREATED`, `HOLIDAY_SET`, `HOLIDAY_REMOVED`, `WORK_SCHEDULE_SET`, entity types `holiday_calendar`, `work_schedule`.
- `lib/schedule.ts` (new): `priceRange`.
- `services/schedule.ts` (new): calendars, holidays, schedules, and `priceForEmployee(db, ctx, employeeId, start, end)` that loads the rows and calls `priceRange`. It takes the transaction client so submit can use it.
- `services/requests.ts`: the submit rule above, `toRequestDto` adds `computation`, and a `previewRequest` function.
- `routes/schedule.ts` (new) with calendars and schedules, `routes/requests.ts` gets the preview route.
- Mounts: `app.use("/holiday-calendars", requireAdmin, calendarsRouter)` and the schedule routes join `/employees` behind `requireAdmin`.
- `scripts/requests-test.sh` and `scripts/yearend-test.sh`: any case that relied on the 24 hours a day cap or on weekend dates is rewritten to fit the schedule. They are reviewed in the implementation chunk.

## Edge cases

- Range of one day that is a holiday or a weekend: NO_WORKING_DAYS.
- Employee works Saturday: `workDays` contains 6, Saturday is a `WORKDAY`.
- Holiday on a non working weekday: reported as `NON_WORKDAY`, it costs nothing either way.
- Schedule changes inside the range: each day uses the row in force that day.
- Schedule names a calendar, later removed: calendars are never deleted in this feature, so it cannot dangle.
- No default calendar and no schedule row: standard hours, no holidays.
- Two calendars with the same holiday date: independent, a day only looks at its own employee's calendar.
- 6 hour worker requests 4 hours on one day: accepted as `GIVEN`, within the 6.
- Hours 6.0001 on a 6 hour day: HOURS_TOO_LARGE.
- Employee schedule `hoursPerDay` 7.5: allowed, 4 decimals.
- Preview for a range over 366 days: validation error.
- Replay of a computed submit after the schedule changed: returns the stored request, 200.
- Holiday loaded for a past date: allowed, it only affects requests submitted afterwards.

## Non-goals

No holiday rules ("fourth Thursday"), no import from an external calendar, no floating or half day holidays. No per state calendar logic beyond one calendar per employee. No changing the default calendar after creation, no deleting calendars. No day based accrual rates. No recomputing or refunding approved requests when holidays change. No effect on the monthly accrual or on payroll accrual. No hours per weekday (a 4 by 10 week is expressed with `workDays`, not different hours on different days).
