# requests-and-approvals: dataflow

Scenario: today is 2026-10-12. emp_2201 is on "PTO Standard" (10 hours a month, no `maxNegativeHours`) with a balance of 24.0000. They submit two requests of 16 hours each: A for Mon 2026-11-02 to Tue 2026-11-03, and B for Mon 2026-11-09 to Tue 2026-11-10. The admin is usr_2217.

## Success path: submit A, approve A

```
POST /requests
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: emp_2201
x-role: EMPLOYEE

{"employeeId":"emp_2201","type":"VACATION","startDate":"2026-11-02","endDate":"2026-11-03","hours":"16","idempotencyKey":"req-9f31"}
```

1. **Auth** builds the ctx, role EMPLOYEE. **Route** validates the body, the employee id matches `x-user-id`.
2. **Service** finds the VACATION assignment of emp_2201 covering Nov 2 to Nov 3 (PTO Standard, since 2026-01-01). 16 hours is under 24 a day.
3. **Write** one transaction: insert the request as PENDING, audit `REQUEST_CREATED`. Response `201`, status PENDING. The balance is still 24.0000, nothing is held.

B is submitted the same way and also gets 201. Now the admin approves A:

```
POST /requests/<A>/approve
x-user-id: usr_2217
x-role: ADMIN
```

1. **Lock** request A `FOR UPDATE`: PENDING.
2. **Policy version** in force on 2026-11-02: TIME, 10 hours, no `maxNegativeHours`, so the floor is 0.
3. **Lock the balance** row of (emp_2201, PTO Standard): 24.0000.
4. **Check**: 24.0000 - 16.0000 = 8.0000, not below 0.
5. **postEntry**: kind `TIME_OFF`, hours -16.0000, `occurred_on` 2026-11-02, key `request:<A>:debit`. The balance becomes 8.0000.
6. **Update** A to APPROVED with `decided_by` usr_2217, audit `REQUEST_APPROVED`.
7. **Response**: `200`, status APPROVED. Approving A again returns the same 200 and writes nothing.

## Failure path: approve B

```
POST /requests/<B>/approve
```

Steps 1 to 3 are the same, but the locked balance is now 8.0000. The check: 8.0000 - 16.0000 = -8.0000, below the floor of 0.

```
422 {"error":{"code":"INSUFFICIENT_BALANCE","message":"approving needs 16.0000 hours, available 8.0000"}}
```

The transaction rolls back: B stays PENDING, no ledger entry, no audit row. The admin can reject B, or wait. The October accrual run on 2026-11-01 adds 10.0000 hours, after which the same call succeeds. If the policy had `maxNegativeHours` 8, the floor would be -8 and this approval would pass, leaving the balance at -8.0000.

If both admins click at the same moment on A and B, both wait on the balance row lock. Whoever gets it first sees 24.0000 and passes, the other sees 8.0000 and gets this 422. Exactly one request is approved.
