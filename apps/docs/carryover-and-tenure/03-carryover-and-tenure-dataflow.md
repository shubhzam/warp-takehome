# carryover-and-tenure: dataflow

Scenario: today is 2026-10-12. Policy "PTO Tenure" gives 10 hours a month, 12 after 2 years of service and 15 after 5. emp_5501 started on 2024-03-10 and has been assigned since 2026-01-01. The admin is usr_2217. Second scenario, further down: "PTO Carry" caps carryover at 8 hours.

## Success path: tenure

```
PUT /employees/emp_5501/start-date
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: usr_2217
x-role: ADMIN

{"startDate":"2024-03-10"}
```

1. **Auth** builds the ctx. **Route** validates the body and calls `setStartDate`.
2. **Write** one transaction: read the current row (none), insert it, audit `EMPLOYEE_START_DATE_SET` with `before` null and `after` `{startDate: "2024-03-10"}`. Response `200 {"employeeId":"emp_5501","startDate":"2024-03-10"}`.

Later the March accrual runs (`POST /accrual-runs` for 2026-03):

1. **Read** the assignments, the policy versions and, in one query, the start dates of the employees in the run.
2. **Compute** emp_5501, 31 active days. The 2-year anniversary is 2026-03-10. Days 1 to 9 have 1 year of tenure and earn 10 / 31 each, days 10 to 31 have 2 years and earn 12 / 31 each. (9 x 10 + 22 x 12) / 31 = 354 / 31 = 11.4194. The `detail` holds two segments: 9 days at 10 with tenure 1, 22 days at 12 with tenure 2.
3. **Write** through `postEntry`, key `accrual:emp_5501:<policy>:2026-03`. emp_5502 (started 2021-01-15, 5 years since January) earns 15.0000. emp_5503 has no start date, so tenure counts from 2026-01-01 and it earns 10.0000.

## Success path: year end

PTO Carry gives 10 hours a month and caps carryover at 8. emp_5511 has 20.0000 hours on 2025-12-31.

```
POST /year-end-runs
{"year":2025}
```

1. **Check** 2026-01-01 is over. **Policy version** in force on 2025-12-31 has a cap of 8.
2. **Group** the ledger up to 2025-12-31 per employee: emp_5511 20.0000, emp_5512 4.8387, emp_5513 -4.0000. Only emp_5511 is over the cap.
3. **Per candidate** one transaction: lock the balance of emp_5511, read the sum again (20.0000), post kind `EXPIRATION`, hours -12.0000, `occurred_on` 2025-12-31, key `expiry:emp_5511:<policy>:2025`. The balance becomes 8.0000.
4. **Audit**: one `YEAR_END_RUN` row. **Response**: `200 {"year":2025,"created":1,"alreadyExpired":0,"skipped":2}`.

The run is nine months late, so the current balance of emp_5511 drops by 12 now, while the balance as of December 31 reads 8.0000, which is what matters for the 2025 books.

## Failure path: a rerun and a year not over

The same call arrives again, or two admins send it at the same moment. The grouped query leaves out the 2025 `EXPIRATION` entries, so emp_5511 is again a candidate at 20.0000. The insert hits `ON CONFLICT DO NOTHING` on the key, `postEntry` says no, and the balance is untouched. The second caller waits on the first one's balance lock and ends up here.

```
200 {"year":2025,"created":0,"alreadyExpired":1,"skipped":2}
```

For the year in progress:

```
POST /year-end-runs {"year":2026}
422 {"error":{"code":"YEAR_NOT_ENDED","message":"2026 ends on 2026-12-31"}}
```

Nothing is written, not even an audit row. If emp_5511 had also had a retroactive leave request approved for December after the first run, that request's debit would not change the expiry already posted. The admin corrects it with an adjustment, so the ledger shows both.
