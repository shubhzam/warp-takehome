# carryover-and-tenure: planning

## 1. Functional knowledge

Two rules that real policies have and the first four features do not.

Tenure: people who have been with the company longer earn more. A policy can say "10 hours a month, 12 after 2 years, 15 after 5 years". For that the system must know when an employee started, and it must switch the rate on the anniversary day, not on the first of the next month.

Carryover: unused time off does not pile up forever. A policy can say "at most 8 hours carry into the next year". At the end of the year, whatever is above the cap expires. Without a rule, everything carries over, which is what the system did until now.

Needs the ledger (expiry is a negative entry, not an edit of a balance), policies (the tiers and the cap live in the policy version), and the monthly accrual run (tiers change what it computes). Wrong if reordered: before the ledger there is nothing to expire, and before versioned policies a cap change would rewrite history.

## 2. Pattern

Two patterns. Tenure is a pure calculation on top of dated facts: the start date and the tier table go in, hours come out, and nothing is stored but the start date. Carryover is a closing run: a once-a-year, idempotent batch that writes compensating ledger entries, the same shape as the accrual runs.

## 3. Entities

New: `employee_start_dates`, one row per employee with the date they started. It is its own table because the system has no employee entity, and because the audit log needs a uuid to point at.

Changed, not new: a TIME accrual config can carry `tiers`, a policy config can carry `carryover`. Both are inside the existing policy version JSON, so history stays versioned.

Not entities: a tier (part of the policy version), an expiry (an ordinary ledger entry of kind `EXPIRATION`), a year-end run (an audit row plus the entries it wrote), a carryover lot (see decision 5).

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| T1 | read or set one employee's start date | (company_id, employee_id) | rare, admin |
| T2 | start dates of all employees in a monthly run | company_id, employee_id in (...) | per monthly run, one query |
| Y1 | balance as of a date, for every employee of every policy with a carryover rule | company_id, policy_id, occurred_on | once a year, large |
| Y2 | policy version in force on December 31 | policy_id, effective_from | once a year, per policy |
| Y3 | write one expiry once, bump the balance | (company_id, idempotency_key) | once a year, per employee over the cap |

## 5. Concurrency

The expiry goes through `postEntry`, so the idempotency key decides: two parallel year-end runs cannot both expire the same employee. Each employee is its own transaction. Inside it the balance row is locked first and the as-of sum is read again under that lock, so an approval that lands during the run is either fully counted or waits. A start date change and a monthly run do not need to coordinate: the run reads the date once, and an entry already posted is never rewritten.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | The start date is an explicit fact in its own table. Without one, tenure counts from the start of that assignment | a start date column on assignments: it changes with every policy move, tenure is about the person |
| 2 | Tiers live inside the TIME accrual config | one policy per tier plus a rule to move people: moves would need a job, and every move is an assignment edit |
| 3 | A tier starts on the anniversary day and the month is split by day, like a policy version change | switching at the next month start: pays the old rate for up to 30 days of the new tenure and needs a second rule |
| 4 | Changing a start date only affects accruals not yet posted | recomputing past months: rewrites history, breaks the append-only ledger |
| 5 | Carryover is a cap applied at year end, written as one `EXPIRATION` entry | tracking each grant as a lot with its own expiry date (FIFO): needs lots, partial consumption and a second ledger |
| 6 | The balance at year end is the sum of ledger entries up to December 31 | the cached balance row: it includes everything posted since, so a late run would expire too much |
| 7 | The year-end run is an admin endpoint, no scheduler | a built-in cron: a second way to trigger work, harder to test and to re-run |
| 8 | First write wins: a re-run reports `alreadyExpired` and never recomputes | updating the expiry when the balance changed: a rewrite, the fix is an adjustment |

## 7. Open questions

1. A year-end run done late can push the current balance below zero. Example: the run happens in March, the employee already booked leave in January and February that was fine against the uncapped balance. The expiry is dated December 31, so as-of balances are right, but the current balance drops. The run belongs in early January. Fixing a late run is an admin adjustment.
2. Without a start date, tenure counts from the start of the assignment. An employee who moves between two policies of the same type would restart their tenure on the second one. Recording the start date is the fix, and the fallback is a convenience, not a promise.
3. Carried hours never expire after a number of months. A cap per year is the whole rule.

## 8. Definition of done

Company A, tenure. Policy "PTO Tenure" (VACATION): 10 hours a month, tiers `[{afterYears 2, hoursPerMonth 12}, {afterYears 5, hoursPerMonth 15}]`. emp_5501 started 2024-03-10, emp_5502 started 2021-01-15, emp_5503 has no start date. All three are assigned from 2026-01-01.

1. Set the two start dates, read them back, read emp_5503's (null).
2. Run the monthly accrual for 2026-03: emp_5501 11.4194 (9 days at 10, 22 days at 12, out of 31), emp_5502 15.0000, emp_5503 10.0000.
3. emp_5501's entry shows two segments, with tenure 1 year then 2 years.
4. Change emp_5503's start date to 2020-06-01 and rerun March: nothing changes, balance still 10.0000.
5. A config with tiers that do not ascend, or tiers on an hours worked policy, is rejected.
6. The earlier numbers still hold: a policy without tiers gives 10.0000, 7.0968 and 11.0323 as before.

Company B, year end. Policy "PTO Carry" (VACATION): 10 hours a month, `maxNegativeHours` 8, `carryover` `{maxHours: 8}`. Policy "PTO Plain" has no carryover rule. All balances come from real accrual runs.

- emp_5511: assigned from 2025-01-01, accrued for 2025-11 and 2025-12, balance 20.0000.
- emp_5512: assigned from 2025-12-17, accrued 4.8387 (15 of 31 days).
- emp_5513: same accruals as emp_5511, then an admin submits and approves a retroactive request of 24 hours for 2025-12-10 to 2025-12-11. Balance as of year end: -4.0000.
- emp_5514: on "PTO Plain", balance 20.0000.

7. `POST /year-end-runs {year: 2025}`: created 1, alreadyExpired 0, skipped 2. emp_5511 gets an `EXPIRATION` of -12.0000 dated 2025-12-31 and ends at 8.0000. The others and emp_5514 are untouched.
8. The same call again: created 0, alreadyExpired 1.
9. Two parallel calls on a fresh year: the employee is expired exactly once.
10. `year: 2026`: 422 YEAR_NOT_ENDED.
11. Every balance equals the sum of its ledger entries, and the audit log holds one `YEAR_END_RUN` row per call and one `EMPLOYEE_START_DATE_SET` row per change.
