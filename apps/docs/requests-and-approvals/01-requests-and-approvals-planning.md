# requests-and-approvals: planning

## 1. Functional knowledge

An employee asks for time off for a date range, an admin approves or rejects it. Approval is the moment hours leave the balance: one negative ledger entry. Cancelling an approved request puts the hours back with a positive entry. A request moves through a small set of states, and every move is audited.

Needs policies and the ledger first: the policy and its rules come from assignments and versions, and the spending goes through the same `postEntry` that accrual uses. Wrong if reordered: requests before the ledger (nothing to spend from), approval before the balance floor check (negative balances nobody allowed).

## 2. Pattern

State machine plus contention. Two admins can approve the same request at once, and two different requests can drain the same balance at once. Double submits happen too. All three are settled by the database (row locks, unique keys, an exclusion constraint), not by app code checking first.

## 3. Entities

- **TimeOffRequest**: employee, the policy it will spend from (found at submit), type, date range, hours, status, and who decided it and why.

Not entities: a decision (fields on the request plus an audit row), a hold on hours (decision 1). Ledger entries already exist, this feature only adds two kinds: `TIME_OFF` and `TIME_OFF_REVERSAL`. Kind is text, so no migration for them.

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| R1 | requests of a company by status, newest first (admin inbox) | company_id, status, created_at | high |
| R2 | requests of an employee, by start date | company_id, employee_id, start_date | high |
| R3 | one request by id | id | high |
| R4 | the assignment of an employee and type covering a date range | employee_id, type | per submit |
| R5 | the debit entry of a request (for the refund) | (company_id, idempotency_key) | rare |
| R6 | lock the balance row of an employee and policy | employee_id, policy_id | per approval |

## 5. Concurrency

Lock order is always request row first, balance row second, so two approvals can never deadlock.

- **Same request approved twice at once**: the second waits on the request row lock, then sees APPROVED and returns 200 without doing anything.
- **Two requests, one balance**: approval locks the balance row and reads it after the lock. The second approval waits, reads the already reduced balance, and is refused if it no longer fits.
- **Approve against cancel**: both lock the request row, one wins, the other sees a final state.
- **Double submit**: unique idempotency key on the request.
- **Overlapping dates for one employee**: an exclusion constraint, not a check in code.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Hours leave the balance on approval, pending requests hold nothing | reserve hours at submit: two more entry kinds, and a release on reject, cancel and every failure path |
| 2 | The floor is checked at approval, under the balance lock. Floor is minus `maxNegativeHours`, default 0 | checking at submit: the balance can change before an admin looks |
| 3 | The requester supplies the hours | computing from the calendar: needs work hours and holidays, which are bonus items |
| 4 | A request names a type, the system finds the policy from the assignment | the employee passing a policy id |
| 5 | One active request per employee per day, enforced by an exclusion constraint | an app-level check: two submits race past it |
| 6 | Cancelling an approved request adds a reversing entry, allowed until the start date | deleting the debit: the ledger is append-only |
| 7 | Repeating a transition (approve an approved request) returns 200 and changes nothing | 409 on every repeat: a double click would show an error for something that worked |
| 8 | Two roles: EMPLOYEE (own requests) and ADMIN (everything) | admin only: the brief says employees request |

## 7. Open questions

1. Hours come from the requester (decision 3). Computing them from work hours and holidays can replace this later.
2. Pending requests hold nothing (decision 1), so an admin can hit 422 on a request that looked fine at submit. The admin rejects it or waits for the next accrual.
3. Retroactive requests are allowed (a start date in the past), for sick days filed late.
4. An admin can approve their own request. The demo has one admin, so this is not blocked.

## 8. Definition of done

1. Balance 24.0000, employee submits 16 hours: 201 PENDING, balance unchanged.
2. Admin approves: APPROVED, one `TIME_OFF` entry of -16.0000, balance 8.0000. Approve again: 200, still one entry.
3. A second 16 hour request approved: 422 INSUFFICIENT_BALANCE, request stays PENDING. On a policy with `maxNegativeHours` 8 the same approval succeeds and the balance is -8.0000.
4. Two requests of 16 hours approved at the same moment against 24 hours: exactly one succeeds.
5. Same idempotency key twice: 200 with the same request. Same key with other hours: 409.
6. Overlapping dates for the same employee: 409 REQUEST_OVERLAP.
7. Cancel an approved request before it starts: CANCELLED, a `TIME_OFF_REVERSAL` of +16.0000, balance restored. Cancel one that has started: 422.
8. An employee cannot read or decide another employee's request. Every balance still equals the sum of its ledger entries, and every transition has an audit row.
