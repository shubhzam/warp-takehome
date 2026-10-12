# policies: dataflow

Scenario: an admin assigns three employees to "Vacation - Full Time US", which accrues 10 hours per month from 2026-11-01. The clock reads 2026-10-11 (UTC).

## Success path

```
POST /policies/0198f3a2-7c41-7b3e-9a10-5d2c8e6f1b47/assignments
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: usr_2217
x-role: ADMIN

{"employeeIds": ["emp_1041", "emp_1042", "emp_1057"], "effectiveFrom": "2026-11-01"}
```

1. **Auth middleware** builds `ctx = {companyId, userId: "usr_2217", role: "ADMIN"}`. ADMIN, continue.
2. **Route** validates params and body with zod, then calls `assignEmployees(ctx, input)`.
3. **Service** opens one transaction:
   - `SELECT id, type FROM policies WHERE id = $1 AND company_id = $2` returns type `VACATION`.
   - `SELECT MIN(effective_from) FROM policy_versions WHERE policy_id = $1` returns 2026-11-01, so the assignment is not before the policy exists.
   - 3 inserts into `assignments` with type `VACATION` and `effective_to` null.
   - 3 inserts into `audit_events`, for example `{action: "ASSIGNMENT_CREATED", entity_type: "assignment", actor_id: "usr_2217", before: null, after: {employeeId: "emp_1041", policyId: "0198f3a2-...", effectiveFrom: "2026-11-01", effectiveTo: null}}`.
   - COMMIT.
4. **Response**: `201 {"assignments": [{"id": "0198f3d4-...", "employeeId": "emp_1041", ...}, ...]}`.

## Failure path: overlap

Another admin assigns emp_1042 to "Vacation - Part Time" from 2026-11-01. The insert violates `assignments_no_overlap` (SQLSTATE 23P01) because emp_1042 already has an open-ended VACATION assignment. The transaction rolls back: 0 assignment rows, 0 audit rows. The service maps the error:

```
409 {"error": {"code": "ASSIGNMENT_OVERLAP", "message": "one or more employees already have a VACATION policy in that date range"}}
```

The same path handles a race. Two requests that both reach the insert at once get one commit and one 23P01.
