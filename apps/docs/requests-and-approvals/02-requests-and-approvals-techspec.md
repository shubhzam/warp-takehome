# requests-and-approvals: techspec

## Version targets

Checked 2026-10-12. No new packages. Node 24, TypeScript 7.0.2, Express 5.3.0, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18, zod ^4.6, uuidv7 1.2.1, decimal.js 10.6.0.

## Problem statement

Lets employees ask for time off and admins approve or reject it. An approved request spends hours from the ledger, a cancelled approved request gives them back. Every transition is audited.

## Requirements

- Ids, dates, hours, error shape and audit rules are the same as policies and ledger. Every write is one transaction that includes its audit row.
- Two roles. `x-role: ADMIN` can do everything. `x-role: EMPLOYEE` means `x-user-id` is the employee id, and that user can only submit, read and cancel their own requests. In `lib/auth.ts` add `requireUser` (accepts both roles) next to `requireAdmin`, and widen the role type in `Ctx`.
- All spending goes through `postEntry` from the ledger service. Nothing else writes `balances`.
- A request is never deleted. Its history is its status plus audit rows.

## State machine

| From | To | Who | Ledger effect |
|---|---|---|---|
| PENDING | APPROVED | admin | `TIME_OFF` entry, hours negative |
| PENDING | REJECTED | admin | none |
| PENDING | CANCELLED | owner or admin | none |
| APPROVED | CANCELLED | owner or admin, only while start date is after today (UTC) | `TIME_OFF_REVERSAL` entry, hours positive |

REJECTED and CANCELLED are final. Repeating the transition a request is already in is a 200 no-op. Any other transition out of a final state, or approving a cancelled one, is 409 INVALID_TRANSITION.

## API contract

| Endpoint | Role | Body | Success | Specific errors |
|---|---|---|---|---|
| POST /requests | any | `{employeeId, type, startDate, endDate, hours, reason?, idempotencyKey}` | 201 request (200 on replay) | 403 FORBIDDEN (employee for someone else), 409 IDEMPOTENCY_KEY_REUSED, 409 REQUEST_OVERLAP, 422 NOT_ASSIGNED, 422 HOURS_TOO_LARGE |
| GET /requests?status=&employeeId= | any | | 200 list, newest first. An employee only sees their own | |
| GET /requests/:id | any | | 200 request | 404 NOT_FOUND (also for someone else's request, as employee) |
| POST /requests/:id/approve | admin | `{reason?}` | 200 request | 409 INVALID_TRANSITION, 422 INSUFFICIENT_BALANCE |
| POST /requests/:id/reject | admin | `{reason}` | 200 request | 409 INVALID_TRANSITION |
| POST /requests/:id/cancel | owner or admin | `{reason?}` | 200 request | 409 INVALID_TRANSITION, 422 TOO_LATE_TO_CANCEL |

Request shape: `{id, employeeId, policyId, type, startDate, endDate, hours, status, reason, decidedBy, decidedAt, decisionReason, createdAt}`, hours as a 4 decimal string.

Shared schemas, in `packages/shared/src/requests.ts` and exported as `./requests`:

```ts
import { z } from "zod";
import { timeOffTypes } from "./policy";

const positiveHours = z.string().regex(/^(?!0+(\.0+)?$)\d+(\.\d{1,4})?$/);
export const requestStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export const createRequestBody = z
  .object({
    employeeId: z.string().min(1),
    type: z.enum(timeOffTypes),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    hours: positiveHours,
    reason: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().min(1).max(100),
  })
  .refine((b) => b.startDate <= b.endDate, { message: "startDate must not be after endDate" });

export const decisionBody = z.object({ reason: z.string().trim().max(500).optional() });
export const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });
export const listRequestsQuery = z.object({
  status: z.enum(requestStatuses).optional(),
  employeeId: z.string().min(1).optional(),
});
```

## Submit rule

1. An employee may only submit for themselves: role EMPLOYEE with `employeeId` different from `x-user-id` is 403.
2. Find the assignment of that employee and `type` that covers every day from `startDate` to `endDate`: `effective_from <= startDate` and (`effective_to` is null or `effective_to > endDate`). Its policy is stored on the request. None: 422 NOT_ASSIGNED.
3. `hours` cannot exceed 24 for each day of the range: 422 HOURS_TOO_LARGE.
4. Insert as PENDING with the audit row `REQUEST_CREATED`. No balance check here: pending requests hold nothing.
5. Replay: if the insert hits the unique key (Prisma P2002), load the existing request. Same employee, type, dates and hours returns it with 200, anything else is 409 IDEMPOTENCY_KEY_REUSED.
6. An overlap with another PENDING or APPROVED request of the same employee fails on `requests_no_overlap`: match the constraint name in the error message and answer 409 REQUEST_OVERLAP.

## Approve rule

One transaction:

1. `SELECT ... FROM time_off_requests WHERE id AND company_id FOR UPDATE`. Missing: 404. Already APPROVED: return it with 200. Not PENDING: 409.
2. Read the policy version in force on `startDate` (`versionInForce`). If its accrual is UNLIMITED, skip to step 6: there is no balance and no entry.
3. `lockBalance(tx, ctx, employeeId, policyId)`: insert the balance row with 0 if it is missing (`ON CONFLICT DO NOTHING`), then `SELECT hours FROM balances WHERE employee_id AND policy_id FOR UPDATE`. Returns the locked hours as a Decimal. Put it in `services/ledger.ts` next to `postEntry`.
4. Floor is `-maxNegativeHours` (0 if absent). If `balance - request hours < floor`: throw 422 INSUFFICIENT_BALANCE with both numbers in the message. The transaction rolls back and the request stays PENDING.
5. `postEntry` with kind `TIME_OFF`, hours negated, `occurredOn` the request's `startDate`, key `request:{requestId}:debit`, `detail` `{requestId}`, reason the request's reason.
6. Set status APPROVED, `decided_by`, `decided_at`, `decision_reason`. Audit `REQUEST_APPROVED`.

Reject sets REJECTED with the required reason and audits `REQUEST_REJECTED`, no ledger.

## Cancel rule

1. Lock the request row. Already CANCELLED: 200 no-op. REJECTED: 409. An EMPLOYEE that does not own it: 404.
2. If it is APPROVED and `startDate <= today` (UTC): 422 TOO_LATE_TO_CANCEL. After the start, fix it with an admin adjustment.
3. If it is APPROVED: look up the entry with key `request:{requestId}:debit`. If one exists, lock the balance and `postEntry` kind `TIME_OFF_REVERSAL`, hours positive (the debit negated), `occurredOn` today, key `request:{requestId}:credit`. No entry exists for an UNLIMITED policy, so nothing is refunded.
4. Set CANCELLED, audit `REQUEST_CANCELLED`.

## Schema

Add `requests TimeOffRequest[]` to the `Policy` model, then append:

```prisma
model TimeOffRequest {
  id             String    @id @db.Uuid
  companyId      String    @map("company_id") @db.Uuid
  employeeId     String    @map("employee_id")
  policyId       String    @map("policy_id") @db.Uuid
  type           String
  startDate      DateTime  @map("start_date") @db.Date
  endDate        DateTime  @map("end_date") @db.Date
  hours          Decimal   @db.Decimal(10, 4)
  status         String
  reason         String?
  idempotencyKey String    @map("idempotency_key")
  decidedBy      String?   @map("decided_by")
  decidedAt      DateTime? @map("decided_at") @db.Timestamptz(3)
  decisionReason String?   @map("decision_reason")
  createdBy      String    @map("created_by")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  policy         Policy    @relation(fields: [policyId], references: [id])

  @@unique([companyId, idempotencyKey])
  @@index([companyId, status, createdAt(sort: Desc)])
  @@index([companyId, employeeId, startDate(sort: Desc)])
  @@map("time_off_requests")
}
```

Raw SQL appended to the generated migration (`--create-only --name requests`):

```sql
-- the state machine only knows four states, a typo in code fails here
ALTER TABLE time_off_requests ADD CONSTRAINT requests_status_valid
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));

-- one active request per employee per day, rejected and cancelled ones do not count
ALTER TABLE time_off_requests ADD CONSTRAINT requests_no_overlap
  EXCLUDE USING gist (company_id WITH =, employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('PENDING', 'APPROVED'));
```

`btree_gist` already exists from the policies migration. The range is closed (`'[]'`) because a request's end date is a day taken, unlike assignments where `effective_to` is exclusive.

Index to access pattern (planning section 4): (company_id, status, created_at desc) serves R1, (company_id, employee_id, start_date desc) serves R2, the primary key R3, the gist index behind `assignments_no_overlap` R4, the ledger unique key R5, the balances primary key R6.

## Changes to existing code

- `lib/audit.ts`: add actions `REQUEST_CREATED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED` and entity type `request`. One audit row per transition, `before` and `after` carry the status, and `after` carries the ledger entry key when one was written.
- `services/ledger.ts`: export `lockBalance`, and widen the entry kind type to allow `TIME_OFF` and `TIME_OFF_REVERSAL` if it is a union.
- `lib/auth.ts`: `requireUser` as above. The approve and reject routes use `requireAdmin` on the route itself.

## Edge cases

- UNLIMITED policy: approval and cancellation change status only, no ledger entry, no balance row.
- Balance row missing (never accrued): created with 0 under the lock, so a request can still be approved up to `maxNegativeHours`.
- Approval looks at the policy version in force on the start date, not today.
- Approval spends immediately, even for a request months ahead. Hours accrued later do not change that entry.
- A failed approval (422) writes nothing, including no audit row.
- Assignment ended after submit: approval does not check the assignment again.
- Two admins approve the same request at once: the second sees APPROVED and gets the same 200.
- Retroactive request (start date in the past): allowed, approval writes the entry with that `occurredOn`. It cannot be cancelled afterwards.
- Database down or timing out: the transaction rolls back and the API answers 503.

## Non-goals

No computing hours from work hours or holidays, no half days. No holds on pending requests, no expiry of pending requests. No notifications. No editing a request (cancel and resubmit). No approval chains, no manager role, no self-approval block. No audit read endpoint, no pagination.
