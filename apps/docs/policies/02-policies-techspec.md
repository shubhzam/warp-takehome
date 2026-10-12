# policies: techspec

## Version targets

Checked 2026-10-11. Node 24, TypeScript 7.0.2, Express 5.3.0, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18 (btree_gist ships in the official image), zod ^4.6, uuidv7 1.2.1.

## Problem statement

Stores policies, their versioned rules, and which employees are on which policy, with an audit trail. Later features read it to find the policy and rules in force for an employee on a date.

## Requirements

- Every write is one transaction that includes its `audit_events` row.
- `company_id`, `user_id` and role come from the headers `x-company-id`, `x-user-id`, `x-role`. Every endpoint needs ADMIN.
- Ids are uuidv7 made in the app. `employee_id` is an opaque text id from Employee Service and is not validated here.
- Dates are `YYYY-MM-DD` strings at the API. Amounts are decimal strings, never JS numbers.
- Audit events and policy versions are never updated or deleted.

## API contract

Errors share one shape: `{"error":{"code","message"}}`. Common: 400 VALIDATION_ERROR, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND (also for another company's ids).

| Endpoint | Body | Success | Specific errors |
|---|---|---|---|
| POST /policies | `{name, type, effectiveFrom, config, reason?}` | 201 `{policy, version}` | 409 DUPLICATE_NAME |
| GET /policies | | 200 `[{id, name, type, inForce}]` | |
| GET /policies/:id?asOf= | | 200 `{policy, versions[], inForce \| null}` (asOf defaults to today) | |
| POST /policies/:id/versions | `{effectiveFrom, config, reason}` | 201 version | 422 EFFECTIVE_DATE_IN_PAST |
| POST /policies/:id/assignments | `{employeeIds[1..500], effectiveFrom}` | 201 `{assignments[]}` | 409 ASSIGNMENT_OVERLAP, 422 EFFECTIVE_BEFORE_POLICY_START |
| GET /employees/:employeeId/assignments | | 200 list | |
| PATCH /assignments/:id | `{effectiveTo}` | 200 assignment | 422 INVALID_END_DATE |

Rules: the first version of a policy may start on any date, so existing staff can be backfilled. Later versions must start today or later. `type` is VACATION, SICK or PARENTAL. An assignment is the same type as its policy.

`config`, in `packages/shared` and exported as `./policy` (adding the `exports` entry is its own step):

```ts
// amounts are decimal strings with up to 4 decimals
const decimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

const accrual = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNLIMITED") }),
  z.object({ kind: z.literal("TIME"), hoursPerMonth: decimal }),
  z.object({ kind: z.literal("HOURS_WORKED"), earnHours: decimal, perHoursWorked: decimal }),
]);

export const timeOffTypes = ["VACATION", "SICK", "PARENTAL"] as const;

// maxNegativeHours is how far below zero the balance may go, absent means 0
export const policyConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    accrual,
    maxNegativeHours: decimal.optional(),
  })
  .strict()
  .refine((c) => !(c.accrual.kind === "UNLIMITED" && c.maxNegativeHours !== undefined), {
    message: "maxNegativeHours is not allowed on an unlimited policy",
  });
```

## Schema

```prisma
model Policy {
  id          String          @id @db.Uuid
  companyId   String          @map("company_id") @db.Uuid
  name        String
  type        String
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  versions    PolicyVersion[]
  assignments Assignment[]

  @@unique([companyId, name])
  @@map("policies")
}

model PolicyVersion {
  id            String   @id @db.Uuid
  policyId      String   @map("policy_id") @db.Uuid
  versionNo     Int      @map("version_no")
  effectiveFrom DateTime @map("effective_from") @db.Date
  config        Json
  createdBy     String   @map("created_by")
  reason        String?
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  policy        Policy   @relation(fields: [policyId], references: [id])

  @@unique([policyId, versionNo])
  @@index([policyId, effectiveFrom(sort: Desc), versionNo(sort: Desc)])
  @@map("policy_versions")
}

model Assignment {
  id            String    @id @db.Uuid
  companyId     String    @map("company_id") @db.Uuid
  employeeId    String    @map("employee_id")
  policyId      String    @map("policy_id") @db.Uuid
  type          String
  effectiveFrom DateTime  @map("effective_from") @db.Date
  effectiveTo   DateTime? @map("effective_to") @db.Date
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  policy        Policy    @relation(fields: [policyId], references: [id])

  @@index([policyId, effectiveFrom])
  @@map("assignments")
}

model AuditEvent {
  id         String   @id @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  actorId    String   @map("actor_id")
  actorRole  String   @map("actor_role")
  action     String
  entityType String   @map("entity_type")
  entityId   String   @map("entity_id") @db.Uuid
  before     Json?
  after      Json?
  reason     String?
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([companyId, entityType, entityId, createdAt(sort: Desc)])
  @@map("audit_events")
}
```

`type` is copied onto the assignment because an exclusion constraint cannot join to another table.

Raw SQL appended to the generated migration (`prisma migrate dev --create-only --name policies`, then edit):

```sql
-- lets the exclusion constraint use = on text next to && on ranges
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- an assignment must end after it starts
ALTER TABLE assignments ADD CONSTRAINT assignments_range_valid
  CHECK (effective_to IS NULL OR effective_to > effective_from);

-- one policy per employee per type at any point in time
ALTER TABLE assignments ADD CONSTRAINT assignments_no_overlap
  EXCLUDE USING gist (employee_id WITH =, type WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

-- audit events and policy versions can be inserted but never changed
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER policy_versions_append_only BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

Audit actions: POLICY_CREATED, POLICY_VERSION_CREATED, ASSIGNMENT_CREATED, ASSIGNMENT_ENDED. One audit row per changed entity.

## Edge cases

- Two concurrent version creates: the policy row lock serializes them, version_nos stay distinct.
- Two concurrent overlapping assigns: the loser hits SQLSTATE 23P01 and gets 409 ASSIGNMENT_OVERLAP.
- Database down or timing out mid-request: the transaction rolls back and the API answers 503. No row exists without its audit row.
- Version with the same `effective_from` as an existing one: allowed, the higher version_no wins.
- asOf before the first version: `inForce` is null.
- Duplicate ids in `employeeIds`, or more than 500: 400.
- Prisma returns `@db.Date` as a JS Date at UTC midnight: convert to `YYYY-MM-DD` at the edge only.

## Non-goals

No balances, ledger or accrual runs. No days unit, no custom work hours, no tenure tiers. No time off types table. No employee validation, no stored groups, no audit read endpoint. No policy rename or delete. No pagination, no timezone handling.
