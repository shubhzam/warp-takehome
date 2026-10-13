## What I built and deliberately skipped
Built, as a Postgres + Express + Prisma API with a Next.js admin console:
1. Versioned time off policies (hours per month, hours worked, unlimited) with tenure tiers, a negative balance floor and year-end carryover
2. An append-only ledger where balances are derived, with monthly and payroll-driven accrual
3. Requests with approve / reject / cancel, idempotent submit, and server-side pricing from the employee's work schedule and holiday calendar
4. An audit log that records every policy, schedule, holiday and request change with before/after, written in the same transaction as the change

Deliberately skipped:
1. Real authentication. The API trusts x-company-id / x-user-id / x-role headers, and the console says so on screen. Production would sit behind Cognito or a JWT.
2. An employee directory. The brief says the Employee Service owns that, so the console takes employee ids as text.
3. Floating and half-day holidays, rule-based holidays ("fourth Thursday"), and day-based accrual rates. Each needs a product decision I would not guess.

## Design
Data:
- policies -> policy_versions (config JSON, effective dated, never edited in place)
- ledger_entries: append-only, enforced by a trigger. Kinds: ACCRUAL, ADJUSTMENT, TIME_OFF, TIME_OFF_REVERSAL, EXPIRATION. Idempotency key unique per entry.
- assignments and requests use Postgres exclusion constraints (btree_gist), so overlaps are rejected by the database, not by app code
- employee_work_schedules, holiday_calendars, holidays, employee_start_dates
- audit_events: the unique-per-company index (company_id, id) with uuidv7 ids, so paging by id is time-ordered

Dataflow:
1. Admin creates a policy version, effective today or later
2. Accrual runs (monthly, or from POST /payroll-accruals as the stand-in for on_payroll_processed) read the version in force per day and write one ledger entry per employee and period
3. Employee previews a range (GET /requests/preview) and submits without hours. The server prices each day as WORKDAY, HOLIDAY or NON_WORKDAY and stores the breakdown on the request
4. Admin approves under a row lock on the balance. A request that would breach the floor gets INSUFFICIENT_BALANCE and stays pending
5. Every write above also writes its audit row in the same transaction

Why this shape: the ledger is the source of truth and everything else is a projection, so a policy change can never rewrite history.

## What happens when what's accrued on changes
1. Changing accrual settings creates a new policy version with an effective date. It never edits the old one.
2. Accrual walks the days of the period and applies the version in force on each day, so a mid-month change is split exactly.
3. Entries already posted do not change. Each accrual entry stores the version and rate segments it used, so the number can always be explained.
4. Negative balances: maxNegativeHours per policy, checked at approval under a lock. Pending requests hold no balance.
5. Mid-period joiners: accrual is day-weighted from the start date. Tenure tiers switch on the anniversary day, and a Feb 29 start moves to Mar 1 in non-leap years.
6. A holiday added after a request is approved does not change that request. The stored price is the record, and a correction is an admin adjustment with a reason.

## prompts I wrote that I'm most proud of
1. (the docs-first prompt) Before generating anything, read the relevant code and ask if scope, entities or approach are ambiguous. Generate exactly 3 docs for the current feature: 01-planning.md (pattern, entities, access patterns, concurrency, decision log with rejected alternatives), 02-techspec.md (API contract, schema, edge cases, non-goals), 03-dataflow.md (one worked example hop by hop, plus one failure path). No code until I say go. --- [This kept every feature specified before it was built, and Claude Code took the docs as input]

## How deep I went, and how long it took
Most of the time went into the specs and into verifying outputs, not typing code. I wrote the planning, techspec and dataflow docs first for each feature, then ran Claude Code against them, and checked every result against numbers I worked out by hand.
Total real effort: [fill in: roughly X hours across design, building and verification].