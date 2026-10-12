# payroll-accrual: techspec

## Version targets

Checked 2026-10-12. No new packages. Node 24, TypeScript 7.0.2, Express 5.3.0, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18, zod ^4.6, uuidv7 1.2.1, decimal.js 10.6.0.

## Problem statement

Earns time off for HOURS_WORKED policies from the hours payroll reports for a finished pay period, posting through the ledger so a resent file never double counts.

## Requirements

- Auth, ids, error shape, audit rules and hour formats are the same as the earlier features. Every endpoint needs ADMIN.
- Every ledger write goes through `postEntry`. No schema change, no migration.
- A resend of the same data changes nothing. A resend with different hours never rewrites an entry.
- A balance row always equals the sum of its ledger entries.

## API contract

| Endpoint | Body | Success | Specific errors |
|---|---|---|---|
| POST /payroll-accruals | `{periodStart, periodEnd, entries[1..500]}`, each entry `{employeeId, hoursWorked}` | 200 `{periodStart, periodEnd, created, alreadyAccrued, skipped, mismatched[]}` | 422 PERIOD_NOT_ENDED |

`mismatched` items are `{employeeId, policyId, accruedHoursWorked, receivedHoursWorked}`. A pay period ends when the day after `periodEnd` is today or earlier (UTC). `skipped` counts employees with no HOURS_WORKED assignment in the period and employees whose earned hours come to zero. Reading balances and the ledger uses the existing endpoints.

Shared schema, in `packages/shared/src/payroll.ts` and exported as `./payroll` (the `exports` entry is its own step):

```ts
import { z } from "zod";

const hoursWorked = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const payrollAccrualBody = z
  .object({
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    entries: z.array(z.object({ employeeId: z.string().min(1), hoursWorked })).min(1).max(500),
  })
  .refine((b) => b.periodStart <= b.periodEnd, { message: "periodStart must not be after periodEnd" })
  // a pay period is a few weeks, anything longer is a typo
  .refine((b) => (Date.parse(b.periodEnd) - Date.parse(b.periodStart)) / 86_400_000 < 62, {
    message: "a pay period is at most 62 days",
  })
  .refine((b) => new Set(b.entries.map((e) => e.employeeId)).size === b.entries.length, {
    message: "employeeIds must be unique",
  });
```

## Accrual rule

Per employee, per time off type: among the assignments that overlap the pay period, take the one with the latest `effective_from`. Its active days are the days of the pay period inside it (`effective_from` up to but not including `effective_to`). Call their count `n`.

For each active day, find the policy version in force that day (latest `effective_from` on or before it, higher `version_no` wins ties). A HOURS_WORKED version earns `(hoursWorked / n) * earnHours / perHoursWorked` that day, any other version earns 0, and so does a `perHoursWorked` of 0. Add the days up in decimal.js and round once, half up, to 4 decimals.

This is the monthly rule with a different daily amount, so the pure function sits next to `computeAccrual` in `lib/accrual.ts` as `computeWorkedAccrual({periodStart, periodEnd, hoursWorked, assignmentFrom, assignmentTo, versions})`. It returns the hours plus the day split for `detail`.

## Write rule

1. Reject if the period is not over: 422 PERIOD_NOT_ENDED.
2. Read the assignments of the listed employees overlapping the period, then the versions of their policies up to `periodEnd`. Pick one assignment per employee and type as above.
3. For each pick, compute. Zero goes to `skipped`. Otherwise post, one transaction per entry:
   - kind `ACCRUAL`, `occurred_on` the `periodEnd`, `period` `"{periodStart}/{periodEnd}"`
   - key `payroll:{employeeId}:{policyId}:{periodStart}:{periodEnd}`
   - `detail` `{source: "PAYROLL", hoursWorked, activeDays, segments: [{versionNo, days, earnHours, perHoursWorked}]}`
4. If `postEntry` says the key was already used, read that entry. Same `hoursWorked` in its detail: `alreadyAccrued`. Different: add to `mismatched`, change nothing.
5. Write one `PAYROLL_ACCRUAL_RUN` audit row (entity `company`) with the dates and the counts.

## Changes to existing code

- `lib/audit.ts`: add the action `PAYROLL_ACCRUAL_RUN`.
- `lib/accrual.ts`: add `computeWorkedAccrual`.
- `services/payroll.ts` (new): `runPayrollAccrual(prisma, ctx, input)`.
- `routes/payroll.ts` (new) and one mount `app.use("/payroll-accruals", requireAdmin, payrollRouter)`.

## Edge cases

- An employee on a time based policy and an hours worked policy of another type: only the second accrues here, the first through the monthly run.
- A policy version changes from HOURS_WORKED to TIME inside the period: days under the TIME version earn 0 here, and the monthly run covers them.
- Joiner mid-period: all their hours count, spread over the days since joining.
- Leaver mid-period (assignment ended): all their hours count, spread over the days until the end.
- Moved between two policies of the same type inside one period: the later one gets all the hours.
- An assignment added after the file was first sent: sending the whole file again accrues just that employee, everyone else is `alreadyAccrued`.
- A crash halfway: entries already written stay, a resend writes the missing ones.
- Overlapping pay periods for one employee have different keys and both accrue. Keeping periods apart is the sender's job.
- Database down mid-run: the API answers with an error, written entries stay, a resend is safe.

## Non-goals

No stored timesheets, no daily hours, no revision entries (corrections are adjustments). No payroll provider integration or scheduler, the endpoint is what a sender calls. No balance caps, no carryover, no expiry. No new reads, no pagination.
