# policies: planning

## 1. Functional knowledge

From the Warp brief: a company defines policies that are unlimited or accrual-based (by time, or by hours worked), per time off type (vacation, sick, parental). Rules change over time and a change must never rewrite the past. Admins assign any group of employees to a policy, and an employee has one policy per type at a time. This feature stores those facts and answers one question: which policy is employee E on for type T on date D, and what were its rules on D? Nothing here moves a balance.

Needs the scaffold and header auth first. Wrong if reordered: assignments before versions (nothing to point at), audit added later (changes with no record).

## 2. Pattern

Contention only: two admins can edit one policy, or assign one employee, at the same moment. Everything else is single-transaction CRUD.

## 3. Entities

- **Policy**: stable identity, one type, unique (company_id, name).
- **PolicyVersion**: immutable rules plus a start date.
- **Assignment**: employee on a policy for a date range.
- **AuditEvent**: who, what, before, after, why.

Not entities: a group (a list of ids in the request, Employee Service owns membership), a time off type (a fixed list in code), a "current version" (derived).

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| A1 | create policy + version 1 + audit | (company_id, name) | rare |
| A2 | version in force for a policy on date D | policy_id, effective_from <= D, newest first, limit 1 | highest, every later feature reads it |
| A3 | create version (next version_no) | policy row lock | rare |
| A4 | list policies, get one with versions | company_id; policy_id | low |
| A5 | assign a group, overlap check, audit | employee_id, type, date range | rare |
| A6 | assignments of an employee | employee_id | low |
| A7 | end an assignment | pk | rare |

## 5. Concurrency

Two version inserts could take the same version_no: `FOR UPDATE` on the policy row serializes them. Two assigns could both pass an app-side overlap check: an exclusion constraint makes the database the judge.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | `policies` (identity) split from `policy_versions` (rules) | edit in place: loses history |
| 2 | Version in force = latest `effective_from <= D`, no `effective_to` | end dates: gaps and overlaps become possible |
| 3 | Overlap blocked by an exclusion constraint | app-only check: loses the race |
| 4 | Config is jsonb validated by a zod union with `schemaVersion: 1` | a column per rule: null-heavy, churns on every new rule |
| 5 | Time off types are a fixed list in code | a types table and CRUD: more surface, no payoff yet |
| 6 | Audit row in the same transaction, append-only by trigger | async audit: can lose events |

## 7. Open questions

1. Amounts are hours only, accrual is monthly only. Days and other frequencies arrive with the custom work hours bonus. OK?
2. "Today" is the UTC date until Company Service gives a timezone.
3. Verify Prisma 7 `migrate dev` leaves the exclusion constraint and triggers alone (second run says "Already in sync").

## 8. Definition of done

1. Create a policy: 201, version 1 and one audit row exist. `?asOf=` before its start returns `inForce: null`, on or after returns v1.
2. Add v2 two months out: asOf between returns v1, after returns v2.
3. A new version dated in the past: 422.
4. Assign 3 employees: 201, 3 assignment rows, 3 audit rows.
5. Overlapping assign: 409, zero rows added. Two parallel overlapping assigns give one 201 and one 409.
6. Ten parallel version creates give ten distinct version_nos.
7. `UPDATE` on `audit_events` or `policy_versions` fails in psql.
