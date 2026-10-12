# payroll-accrual: dataflow

Scenario: today is 2026-10-12. Payroll sends the pay period 2026-03-16 to 2026-03-31 (16 days). Policy "Sick Earned" earns 1 hour per 30 worked, and a version from 2026-03-25 earns 1 hour per 20. emp_4401 has been on it since January and worked 80 hours. emp_4402 joined it on 2026-03-24 and worked 40. emp_4403 only has a time based vacation policy and worked 20.

## Success path

```
POST /payroll-accruals
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: usr_2217
x-role: ADMIN

{"periodStart":"2026-03-16","periodEnd":"2026-03-31","entries":[
  {"employeeId":"emp_4401","hoursWorked":"80"},
  {"employeeId":"emp_4402","hoursWorked":"40"},
  {"employeeId":"emp_4403","hoursWorked":"20"}]}
```

1. **Auth** builds the ctx. **Route** validates the body, then calls `runPayrollAccrual`.
2. **Service** checks the period is over: the day after 2026-03-31 is long past.
3. **Read** the assignments of the three employees overlapping the period, and the versions of the policies involved.
4. **Compute** each employee, hours worked spread over their days on the policy, each day at the rate in force:
   - emp_4401: 16 days, 5 hours a day. Nine days at 1 per 30 give 45 / 30 = 1.5. Seven days (Mar 25 to 31) at 1 per 20 give 35 / 20 = 1.75. Total 3.2500.
   - emp_4402: 8 days (Mar 24 to 31), 5 hours a day. One day at 1 per 30 gives 5 / 30 = 0.1667, seven days at 1 per 20 give 1.75. Total 1.916667, rounded once to 1.9167.
   - emp_4403: no HOURS_WORKED assignment, skipped. The monthly run covers their vacation policy.
5. **Write** one transaction per entry, through `postEntry`: kind `ACCRUAL`, `period` `2026-03-16/2026-03-31`, key `payroll:emp_4401:<policy>:2026-03-16:2026-03-31`, and a `detail` holding `hoursWorked`, `activeDays` and the two segments.
6. **Audit**: one `PAYROLL_ACCRUAL_RUN` row with the dates and counts.
7. **Response**: `200 {"periodStart":"2026-03-16","periodEnd":"2026-03-31","created":2,"alreadyAccrued":0,"skipped":1,"mismatched":[]}`. Balances 3.2500 and 1.9167.

## Failure path: a corrected file

Payroll fixes emp_4401 to 90 hours and sends the file again, emp_4402 unchanged.

For emp_4402 the insert hits `ON CONFLICT DO NOTHING` on its key, the stored `hoursWorked` is 40 again, so it counts as `alreadyAccrued`. For emp_4401 the key conflicts too, but the stored `hoursWorked` is 80, not 90. Nothing is rewritten.

```
200 {"periodStart":"2026-03-16","periodEnd":"2026-03-31","created":0,"alreadyAccrued":1,"skipped":0,
     "mismatched":[{"employeeId":"emp_4401","policyId":"<policy>","accruedHoursWorked":"80","receivedHoursWorked":"90"}]}
```

Balances stay 3.2500 and 1.9167. 90 hours would have earned 3.6563, so the admin posts an adjustment of +0.4063 with a reason. That keeps one correction path, and the ledger shows both the original accrual and the fix. If both sends arrive at the same moment, the second waits on the first one's unique key and ends up in the same place.
