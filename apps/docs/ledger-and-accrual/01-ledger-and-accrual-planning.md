# ledger-and-accrual: planning

## 1. Functional knowledge

Balances are never typed in. Every hour an employee earns or loses is a row in an append-only ledger, and the balance is what the rows add up to. This feature adds the ledger, a cached balance per employee and policy, and the monthly accrual that earns hours from a policy's rules. Requests and approvals (feature 3) will spend from the same ledger.

Needs policies first: accrual reads assignments and the policy version in force. Wrong if reordered: accrual before the ledger (nowhere to write), or balances before idempotency (a rerun doubles everyone's hours).

## 2. Pattern

Idempotency: runs get retried, double-clicked and run twice. Contention: an accrual and an adjustment can hit one balance at once. Both end at the database, not in app code.

## 3. Entities

- **LedgerEntry**: one signed change in hours, with a kind (ACCRUAL, ADJUSTMENT, OPENING_BALANCE), who made it, and a unique idempotency key.
- **Balance**: one row per (employee, policy), the running total of its ledger entries, a cache that the ledger can always rebuild.

Not entities: an accrual run (a request that writes entries, its summary goes to audit), a period (a string like `2026-03`).

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| A1 | assignments of a company overlapping a period | company_id, effective_from | monthly, large |
| A2 | all versions of the policies involved | policy_id | monthly |
| A3 | write one entry once, bump the balance | (company_id, idempotency_key) | monthly, large |
| A4 | balances of an employee | company_id, employee_id | highest |
| A5 | ledger of an employee and policy, newest first | company_id, employee_id, policy_id | low |

## 5. Concurrency

The entry insert and the balance update are one SQL statement. The insert uses `ON CONFLICT DO NOTHING` on the idempotency key, and the update only runs if a row was actually inserted. Two overlapping runs cannot both insert the same key, so they cannot both add hours. The update locks the balance row, so an accrual and an adjustment take turns.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Accrue in arrears: a period must be over, each active day earns monthly rate / days in month | whole month if active on the 1st: unfair to joiners, ignores mid-month policy changes |
| 2 | A run is an endpoint, an external scheduler calls it later | cron inside the API: fires twice with two instances, dies with the process |
| 3 | One small transaction per entry | one transaction per run: long locks, one failure loses everything. Idempotency makes a rerun finish the rest |
| 4 | Entry insert and balance update in one statement | two statements: a crash between them leaves the balance wrong |
| 5 | Kind and detail are text and jsonb | an enum: every new kind needs a migration |
| 6 | Hours are numeric(10,4), math in decimal.js, rounded once per entry | JS floats: 0.1 + 0.2 |
| 7 | Entries carry `detail`, the day split behind the number | recomputing later: policies change, the explanation must not |

## 7. Open questions

1. Daily proration in arrears (decision 1). The simpler whole-month rule is the alternative.
2. UNLIMITED and HOURS_WORKED policies earn nothing here. HOURS_WORKED arrives with payroll-accrual.
3. Adjustments are allowed for any employee and policy pair that has an assignment, past or present.

## 8. Definition of done

1. Run 2026-03 with three employees (10h joined earlier, 10h joined 03-10, 12h from 03-16): balances 10.0000, 7.0968, 11.0323.
2. Rerun the same period: nothing created, balances unchanged.
3. Two parallel runs of 2026-04: each employee gains exactly one month.
4. A period that has not ended: 422.
5. Adjustment +5: balance moves. Same key again: same entry, no change. Same key with other hours: 409.
6. For every balance row, hours equals the sum of its ledger entries.
7. `UPDATE` and `DELETE` on `ledger_entries` fail in psql.
