# ledger-and-accrual: dataflow

Scenario: an admin accrues March 2026 on 2026-10-12. Policy "PTO Standard" gives 10 hours a month. Policy "PTO Plus" gave 10 until a version starting 2026-03-16 raised it to 12. emp_2201 has been on Standard since 2026-01-01, emp_2202 joined it on 2026-03-10, emp_2203 is on Plus since January.

## Success path

```
POST /accrual-runs
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: usr_2217
x-role: ADMIN

{"period": "2026-03"}
```

1. **Auth middleware** builds the ctx. **Route** validates the body, then calls `runAccrual(ctx, "2026-03")`.
2. **Service** checks the period is over: it ends 2026-03-31, today is 2026-10-12, fine. March has 31 days.
3. **Read**: assignments overlapping 2026-03-01 to 2026-04-01 for the company (3 rows), then the versions of the two policies.
4. **Compute** each entry with decimal.js, each active day earns monthly rate / 31, rounded once:
   - emp_2201: 31 days at 10 gives 10.0000.
   - emp_2202: 22 days (Mar 10 to 31) gives 220 / 31 = 7.0968.
   - emp_2203: 15 days at 10 plus 16 days at 12 gives 342 / 31 = 11.0323.
5. **Write**, one transaction per entry, for example emp_2202:
   ```sql
   INSERT INTO balances (employee_id, policy_id, company_id, hours) VALUES ('emp_2202', '...', '...', 0) ON CONFLICT DO NOTHING;
   WITH ins AS (
     INSERT INTO ledger_entries (..., kind, hours, idempotency_key, detail)
     VALUES (..., 'ACCRUAL', 7.0968, 'accrual:emp_2202:<policy>:2026-03', '{"daysInPeriod":31,"segments":[{"versionNo":1,"days":22,"monthlyHours":"10"}]}')
     ON CONFLICT (company_id, idempotency_key) DO NOTHING RETURNING hours
   )
   UPDATE balances SET hours = hours + (SELECT hours FROM ins) WHERE employee_id = 'emp_2202' AND policy_id = '...' AND EXISTS (SELECT 1 FROM ins);
   ```
6. **Audit**: one `ACCRUAL_RUN` row with the period and counts.
7. **Response**: `200 {"period":"2026-03","created":3,"alreadyAccrued":0,"skipped":0}`.

## Failure path: the same run again

The admin clicks twice. The second request computes the same three entries. Each insert hits `ON CONFLICT DO NOTHING` on `accrual:emp_2202:<policy>:2026-03`, so `ins` is empty, the `EXISTS` guard is false, and the balance update touches zero rows.

```
200 {"period":"2026-03","created":0,"alreadyAccrued":3,"skipped":0}
```

If both clicks arrive at the same moment, the second insert waits on the first one's unique key, then conflicts and does nothing. Balances stay 10.0000, 7.0968, 11.0323.
