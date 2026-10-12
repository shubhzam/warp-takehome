# payroll-accrual: planning

## 1. Functional knowledge

Some policies earn by hours worked: for every N hours an employee works, they earn M hours of time off. The hours worked come from payroll, which already knows them. This feature takes a finished pay period with hours worked per employee and posts the earned time off to the ledger. It adds no tables. The ledger entry itself records the hours worked and the rate behind the number.

Needs the ledger first: it posts through `postEntry`, which is what makes a resend safe. It also needs policies, because the rate (`earnHours` per `perHoursWorked`) lives in the policy version. Wrong if reordered: before the ledger (nowhere to post), before idempotency (a resent payroll file doubles everyone's hours).

## 2. Pattern

Idempotency again. Payroll files get resent, corrected and replayed, and a retry after a crash must finish the job without repeating it. The computation is a pure function, the database settles who wins.

## 3. Entities

No new entities. An accrual from payroll is an `ACCRUAL` ledger entry, the same kind as the monthly run. What makes it traceable is its `detail`: the hours worked, the days on the policy, and the rate per version.

Not entities: a pay period (two dates in the request), a timesheet (payroll owns it, we only keep the number we used).

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| P1 | assignments of up to 500 employees overlapping a date range | company_id, effective_from | per payroll run, large |
| P2 | all versions of the policies involved | policy_id | per payroll run |
| P3 | write one entry once, bump the balance | (company_id, idempotency_key) | per payroll run, large |
| P4 | read the entry already written for a key, to compare hours | (company_id, idempotency_key) | only on a resend |

## 5. Concurrency

Same as the monthly run. The entry insert and the balance update are one statement guarded by the idempotency key, so two overlapping sends of the same file cannot both add hours. A payroll send and a leave approval take turns on the balance row lock.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Payroll pushes hours to an endpoint, we store no timesheet | a `worked_hours` table: a second source of truth, overlap rules, and a backfill story |
| 2 | Hours are spread evenly over the days the employee was on the policy, and each day earns at the rate of the version in force that day | spreading over the whole pay period: a mid-period joiner would lose the hours they actually worked |
| 3 | Per type, the latest assignment that touches the period gets all the hours | splitting hours between two assignments: needs daily hours, which payroll does not send |
| 4 | Same key with different hours is reported as `mismatched` and never rewritten. The fix is an admin adjustment | revision entries: a second correction mechanism next to adjustments |
| 5 | Reuse kind `ACCRUAL`, the key carries the period | a new kind: nothing reads kinds differently |
| 6 | The monthly run stays untouched, it already gives HOURS_WORKED versions zero | teaching the monthly run about hours: two features owning one rule |
| 7 | The pay period must be over | accruing partial periods: hours still change |
| 8 | One small transaction per entry | one transaction for the file: long locks, one bad row loses everything |

## 7. Open questions

1. Overlapping pay periods for one employee are the sender's problem (non-goal). The keys differ, so both would accrue.
2. A correction arrives as an adjustment by an admin, not by resending. The `mismatched` list is how the sender finds out.
3. Zero hours worked earns nothing and counts as skipped.

## 8. Definition of done

Policy "Sick Earned" (type SICK) earns 1 hour per 30 worked. A second version from 2026-03-25 earns 1 hour per 20. emp_4401 is on it since January, emp_4402 since 2026-03-24, emp_4404 from January to 2026-03-20 (assignment ended 03-21). emp_4403 is only on a time based policy.

1. Send pay period 2026-03-16 to 2026-03-31 with emp_4401 80h, emp_4402 40h, emp_4403 20h, emp_4404 30h: created 3, skipped 1. Balances 3.2500, 1.9167, none, 1.0000.
2. Send the same file again: created 0, alreadyAccrued 3.
3. Send emp_4401 with 90h: listed in `mismatched`, balance still 3.2500.
4. Two parallel sends of the next pay period: each employee gains exactly once.
5. A pay period that is not over: 422.
6. The monthly accrual run for 2026-03 adds nothing to these employees.
7. Every balance equals the sum of its ledger entries, and each send left one `PAYROLL_ACCRUAL_RUN` audit row.
