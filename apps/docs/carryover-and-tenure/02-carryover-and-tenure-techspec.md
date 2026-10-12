# carryover-and-tenure: techspec

## Version targets

Checked 2026-10-12. No new packages. Node 24, TypeScript 7.0.2, Express 5.3.0, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18, zod ^4.6, uuidv7 1.2.1, decimal.js 10.6.0.

## Problem statement

Pays a higher accrual rate as an employee's years of service grow, and expires hours above a yearly cap when the year ends. Both leave the ledger append-only: tenure changes what new accruals compute, expiry is a new negative entry.

## Requirements

- Auth, ids, error shape, audit rules and hour formats are the same as the earlier features. Every endpoint needs ADMIN. Every write is one transaction that includes its audit row.
- Every ledger write goes through `postEntry`. Entry kinds are free text, so `EXPIRATION` needs no migration.
- A posted entry is never rewritten. Changing a start date or a policy affects only entries not yet posted.
- A policy without `tiers` or `carryover` behaves exactly as before. The numbers from the earlier features do not move.
- A balance row always equals the sum of its ledger entries.

## API contract

| Endpoint | Body | Success | Specific errors |
|---|---|---|---|
| PUT /employees/:employeeId/start-date | `{startDate}` | 200 `{employeeId, startDate}` | |
| GET /employees/:employeeId/start-date | | 200 `{employeeId, startDate}`, `startDate` is null when none is recorded | |
| POST /year-end-runs | `{year}` | 200 `{year, created, alreadyExpired, skipped}` | 422 YEAR_NOT_ENDED |

The start date is stored as given, once per employee. A second PUT replaces it. The employee id is an opaque string, as everywhere else, and is not checked against anything. A year has ended when `{year+1}-01-01` is today or earlier (UTC). `skipped` counts every employee on a policy with a carryover rule whose balance at year end is at or under the cap, including negative ones. Employees with no ledger entries on such a policy, and policies without a rule, are not counted.

Shared schemas. In `packages/shared/src/tenure.ts`, exported as `./tenure`:

```ts
import { z } from "zod";

export const setStartDateBody = z.object({
  startDate: z.iso.date().refine((d) => d >= "1950-01-01", { message: "startDate must not be before 1950-01-01" }),
});
```

In `packages/shared/src/year-end.ts`, exported as `./year-end`:

```ts
import { z } from "zod";

export const yearEndBody = z.object({ year: z.number().int().min(2000).max(2100) });
```

The `exports` entries in `packages/shared/package.json` are their own step.

In `packages/shared/src/policy.ts`, two additions. Use the hours string schema that file already has for `hoursPerMonth` in place of `hours` below:

```ts
const hours = z.string().regex(/^\d+(\.\d{1,4})?$/);

const tier = z
  .object({ afterYears: z.number().int().min(1).max(60), hoursPerMonth: hours })
  .strict();

// strictly ascending, so the rate for a given tenure is unambiguous
export const tiers = z
  .array(tier)
  .max(10)
  .refine((t) => t.every((x, i) => i === 0 || x.afterYears > (t[i - 1]?.afterYears ?? 0)), {
    message: "tiers must have strictly ascending afterYears",
  });

export const carryover = z.object({ maxHours: hours }).strict();
```

Then `tiers` becomes an optional field of the TIME accrual object, and `carryover` an optional top level field of the policy config, next to `maxNegativeHours`. `carryover` is rejected on UNLIMITED, the same way `maxNegativeHours` is. HOURS_WORKED accepts no `tiers` (the object is strict). `schemaVersion` stays 1: both fields are optional, so every stored config is still valid.

## Tenure rule

The start date of an assignment's employee is the recorded one. With none recorded it is the `effective_from` of the assignment being accrued. On a given day, the employee's tenure is the number of whole years completed since the start date. The anniversary day itself counts as completed. A start on February 29 has its anniversary on March 1 in years that are not leap years.

The monthly accrual keeps its rule: an active day earns `monthlyHours / daysInMonth`, summed in decimal.js and rounded once, half up, to 4 decimals. What changes is `monthlyHours`. For an active day, find the version in force that day, as today. If that version is TIME with `tiers`, the day earns at the `hoursPerMonth` of the tier with the highest `afterYears` not above the day's tenure, or at the base `hoursPerMonth` when no tier is reached. Other versions earn as before (0 for HOURS_WORKED and UNLIMITED).

`computeAccrual` takes one more input, `startDate` (the date from above). It walks the active days of the month (at most 31), picks the rate of each, and groups consecutive days with the same version and rate into segments. A segment is `{versionNo, days, monthlyHours}` and, only when its version has tiers, `tenureYears` (the tenure on the segment's first day). The segments go into the entry's `detail` as they do today.

The monthly run reads the start dates of all employees in the run with one query, and passes each one in. `runAccrual` keeps its idempotency key. An employee already accrued for the month stays as posted, even if the start date changes afterwards.

## Year-end rule

1. Reject if the year has not ended: 422 YEAR_NOT_ENDED.
2. For each policy of the company, find the version in force on `{year}-12-31`. Keep the policies whose version has `carryover`, with their cap.
3. One grouped query: for those policies, the sum of ledger `hours` per employee and policy where `occurred_on <= {year}-12-31`, leaving out entries with kind `EXPIRATION` and `period = '{year}'`. The exclusion makes a re-run see the same balance as the first run.
4. A group at or under the cap adds to `skipped`. A group over it is a candidate.
5. For each candidate, one transaction:
   - `lockBalance` on the employee and policy
   - read the as-of sum again for that pair, with the same filter
   - at or under the cap now: add to `skipped`
   - otherwise `postEntry` kind `EXPIRATION`, hours `-(sum - cap)`, `occurred_on` `{year}-12-31`, `period` `"{year}"`, key `expiry:{employeeId}:{policyId}:{year}`, `detail` `{year, balanceAtYearEnd, cap}`, reason `"year end carryover cap"`
   - `postEntry` says the key was used: `alreadyExpired`. Written: `created`.
6. Write one `YEAR_END_RUN` audit row (entity `company`) with the year and the three counts.

An expiry never takes a balance below the cap, and the cap is not negative, so no floor check applies. Entries dated in the year that are posted after an employee's transaction has committed are not counted. Fix those with an adjustment.

## Schema

Append to `schema.prisma`:

```prisma
model EmployeeStartDate {
  id         String   @id @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  employeeId String   @map("employee_id")
  startDate  DateTime @map("start_date") @db.Date
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([companyId, employeeId])
  @@map("employee_start_dates")
}
```

Migration name `tenure`. Prisma generates everything, no raw SQL. The unique index serves T1 and T2. The ledger needs no new index: Y1 runs once a year and scans the entries of a few policies.

## Changes to existing code

- `lib/audit.ts`: add actions `EMPLOYEE_START_DATE_SET`, `YEAR_END_RUN` and entity type `employee_start_date`. The start date row writes `before` (`{startDate}` or null) and `after`.
- `lib/accrual.ts`: `computeAccrual` gets `startDate` and the tier rule above, plus a small helper for whole years of tenure on a day.
- `services/ledger.ts`: `runAccrual` loads the start dates and passes them in.
- `services/tenure.ts` (new): `getStartDate`, `setStartDate`. The upsert runs in a transaction. A lost race on the unique index (P2002) is retried once.
- `services/yearEnd.ts` (new): `runYearEnd(prisma, ctx, input)`.
- `routes/tenure.ts` (new), mounted as `app.use("/employees", requireAdmin, startDatesRouter)`. `routes/yearEnd.ts` (new), mounted as `app.use("/year-end-runs", requireAdmin, yearEndRouter)`.
- `packages/shared`: the files above.

## Edge cases

- Start date after the assignment start (a future hire): no tier is reached, the base rate applies.
- Start date changed after a run: the posted month stays. Only months not yet accrued use the new date.
- February 29 start: the anniversary is March 1 in non-leap years.
- Two tiers cross in one month: three segments, each with its own tenure.
- A version change and an anniversary in the same month: split at both dates.
- A tier lower than the base rate is allowed. It is the policy author's choice.
- Cap of 0: everything positive expires at year end.
- Cap changed by a new version: the version in force on December 31 decides.
- Rule removed in a later version: a year whose December 31 falls under that version expires nothing. Earlier years are untouched.
- Employee whose assignment ended but who still has a balance: expires like everyone else.
- Negative balance at year end: skipped, and no hours are added back.
- Run twice, or two runs at once: the key keeps one expiry. The second call reports `alreadyExpired`.
- Run late: the expiry is dated December 31 and as-of balances are right, but the current balance drops by the expired amount.
- Database down mid-run: written expiries stay, a re-run finishes the rest.

## Non-goals

No holidays, no custom work hours (these two bonus items are still unbuilt). No expiry of carried hours after a number of months, no lots or FIFO, no per-employee caps. No payout of expired hours. No history of start dates, no employee table. No tiers for hours worked policies. No scheduler, the endpoint is what a sender calls. No new reads beyond the start date, no pagination.
