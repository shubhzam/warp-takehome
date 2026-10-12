# ledger-and-accrual: techspec

## Version targets

Checked 2026-10-12. Node 24, TypeScript 7.0.2, Express 5.3.0, Prisma 7.10.0 with @prisma/adapter-pg 7.10.0, PostgreSQL 18, zod ^4.6, uuidv7 1.2.1, decimal.js 10.6.0 (new, `pnpm --filter @repo/api add decimal.js`).

## Problem statement

Keeps each employee's time off balance as an append-only ledger of signed hours, with a cached running total per employee and policy, and earns hours every month from the policy rules in force. Later features spend and expire hours through the same ledger.

## Requirements

- Auth, ids, error shape and audit rules are the same as policies. Every endpoint needs ADMIN.
- Hours are decimal strings at the API (up to 4 decimals, signed), `numeric(10,4)` in the database, and decimal.js in code. Never JS numbers.
- Every ledger write goes through one function, `postEntry`: insert the entry and bump the balance in a single SQL statement, guarded by the idempotency key.
- Ledger entries are never updated or deleted, enforced in the database.
- A balance row always equals the sum of its ledger entries.

## API contract

| Endpoint | Body | Success | Specific errors |
|---|---|---|---|
| POST /accrual-runs | `{period: "2026-03"}` | 200 `{period, created, alreadyAccrued, skipped}` | 422 PERIOD_NOT_ENDED |
| POST /adjustments | `{employeeId, policyId, kind, hours, reason, idempotencyKey}` | 201 entry (200 if the same request is replayed) | 404 NOT_FOUND (policy), 422 NOT_ASSIGNED, 409 IDEMPOTENCY_KEY_REUSED |
| GET /employees/:employeeId/balances | | 200 `[{policyId, policyName, type, hours}]` | |
| GET /employees/:employeeId/ledger?policyId= | | 200 entries, newest first | |

A period ends when the first day of the next month is today or earlier (UTC). `skipped` counts assignments whose period total is zero, such as UNLIMITED policies.

Shared schemas, in `packages/shared/src/ledger.ts` and exported as `./ledger` (the `exports` entry is its own step):

```ts
// signed hours, up to 4 decimals, never zero
const signedHours = z.string().regex(/^-?(?!0+(\.0+)?$)\d+(\.\d{1,4})?$/);

export const accrualRunBody = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const adjustmentKinds = ["ADJUSTMENT", "OPENING_BALANCE"] as const;

export const adjustmentBody = z.object({
  employeeId: z.string().min(1),
  policyId: z.guid(),
  kind: z.enum(adjustmentKinds),
  hours: signedHours,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(1).max(100),
});
```

## Accrual rule

For one assignment and one period: for each day the assignment is active, find the policy version in force that day (latest `effective_from` on or before it, higher `version_no` wins ties). A TIME version earns `hoursPerMonth / daysInPeriod` that day, any other version earns 0. Add the days up in decimal.js and round once, half up, to 4 decimals. The pure function lives in `lib/accrual.ts` and returns the hours plus the day split that goes into `detail`.

Entry fields for an accrual: kind `ACCRUAL`, `occurred_on` the last day of the period, `period` e.g. `2026-03`, key `accrual:{employeeId}:{policyId}:{period}`. A run reads the company's assignments overlapping the period, loads the versions of their policies, computes each entry, and posts each one in its own transaction. It then writes one `ACCRUAL_RUN` audit row with the counts.

## Schema

Add to the `Policy` model: `ledgerEntries LedgerEntry[]` and `balances Balance[]`. Add to the `Assignment` model: `@@index([companyId, effectiveFrom])`. Then append:

```prisma
model LedgerEntry {
  id             String   @id @db.Uuid
  companyId      String   @map("company_id") @db.Uuid
  employeeId     String   @map("employee_id")
  policyId       String   @map("policy_id") @db.Uuid
  kind           String
  hours          Decimal  @db.Decimal(10, 4)
  occurredOn     DateTime @map("occurred_on") @db.Date
  period         String?
  idempotencyKey String   @map("idempotency_key")
  detail         Json?
  reason         String?
  createdBy      String   @map("created_by")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  policy         Policy   @relation(fields: [policyId], references: [id])

  @@unique([companyId, idempotencyKey])
  @@index([companyId, employeeId, policyId, occurredOn(sort: Desc)])
  @@map("ledger_entries")
}

model Balance {
  employeeId String   @map("employee_id")
  policyId   String   @map("policy_id") @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  hours      Decimal  @default(0) @db.Decimal(10, 4)
  updatedAt  DateTime @default(now()) @map("updated_at") @db.Timestamptz(3)
  policy     Policy   @relation(fields: [policyId], references: [id])

  @@id([employeeId, policyId])
  @@index([companyId, employeeId])
  @@map("balances")
}
```

Raw SQL appended to the generated migration (`--create-only --name ledger`):

```sql
-- a zero hour entry says nothing, so refuse it
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_hours_nonzero CHECK (hours <> 0);

-- the ledger is append-only, reuses the guard function from the policies migration
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

`postEntry` runs inside a transaction: first `INSERT INTO balances (...) VALUES (..., 0) ON CONFLICT DO NOTHING`, then the single statement shown in the dataflow doc. It returns whether the entry was new, by counting the rows the insert returned.

Index to access pattern (planning section 4): assignments (company_id, effective_from) serves A1, policy_versions (policy_id, ...) from policies serves A2, ledger unique (company_id, idempotency_key) serves A3, balances (company_id, employee_id) serves A4, ledger (company_id, employee_id, policy_id, occurred_on desc) serves A5.

Audit actions: ACCRUAL_RUN (entity `company`, the company id), ADJUSTMENT_CREATED (entity `ledger_entry`).

## Edge cases

- A period with no active days or only UNLIMITED days totals zero: no entry, counted in `skipped`.
- An assignment that ends mid-period earns only its active days.
- Two versions with the same `effective_from`: the higher `version_no` wins, the lower one covers zero days.
- A run that crashes halfway: entries already written stay, a rerun writes only the missing ones.
- A rerun after a backdated assignment was added: the new pair accrues, existing pairs are untouched. Changing an assignment's end date after accrual does not change old entries, fix it with an adjustment.
- Replaying an adjustment with the same key and the same fields returns the original entry. The same key with different fields is 409.
- An adjustment may push a balance below zero. The floor is enforced on requests (feature 3), not on admin corrections.
- Employees on UNLIMITED policies have no balance row.
- Database down mid-run: the API answers with an error and entries already written stay. A rerun is safe.

## Non-goals

No requests, holds, spending, expiry, carryover, tenure, work hours or holidays. No HOURS_WORKED accrual. No scheduler, the endpoint is what a scheduler will call. No reconciliation endpoint, the balance check is a SQL query in the definition of done. No pagination.
