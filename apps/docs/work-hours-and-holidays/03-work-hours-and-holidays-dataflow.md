# work-hours-and-holidays: dataflow

Scenario: today is 2026-10-12. The company has a default calendar "US" with Thursday 2026-11-26 "Thanksgiving" and Friday 2026-11-27 "Day after Thanksgiving". emp_6601 has no schedule row, so the standard one applies: 8 hours, Monday to Friday. They are on "PTO Standard" with a balance of 40.0000. They want the week of 2026-11-23 to 2026-11-27 off. The admin is usr_2217.

## Success path: preview, submit, approve

```
GET /requests/preview?employeeId=emp_6601&startDate=2026-11-23&endDate=2026-11-27
x-company-id: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10
x-user-id: emp_6601
x-role: EMPLOYEE
```

1. **Auth** builds the ctx, role EMPLOYEE. **Route** validates the query. The employee id matches `x-user-id`, so it passes (another id would be 403).
2. **Read** the schedules of emp_6601 up to 2026-11-27 (none), the company default calendar ("US"), and its holidays inside the range.
3. **Price** each day with `priceRange`: Mon 23, Tue 24, Wed 25 are `WORKDAY` at 8 hours. Thu 26 is `HOLIDAY` "Thanksgiving", Fri 27 is `HOLIDAY` "Day after Thanksgiving". Total 24.0000.
4. **Response**: `200 {"hours":"24.0000","days":[{"date":"2026-11-23","kind":"WORKDAY","hours":"8.0000"}, ... {"date":"2026-11-26","kind":"HOLIDAY","hours":"0.0000","holidayName":"Thanksgiving"}, ...]}`. The form shows "3 work days x 8h, 2 holidays".

The employee submits without `hours`:

```
POST /requests
{"employeeId":"emp_6601","type":"VACATION","startDate":"2026-11-23","endDate":"2026-11-27","reason":"family visit","idempotencyKey":"req-71a2"}
```

5. **Service** finds the VACATION assignment covering the range, then prices the range again inside the transaction. Same answer, 24.0000, source `COMPUTED`.
6. **Write** the request as PENDING with `hours` 24.0000 and `computation` holding the five days, plus the audit row `REQUEST_CREATED`. Response `201`.
7. The admin approves. Approval reads the stored `hours`, never reprices. The balance goes from 40.0000 to 16.0000 with one `TIME_OFF` entry of -24.0000.

If emp_6602 (6 hour days) sends the same range, every step is identical and the total is 3 x 6 = 18.0000.

## Failure path: nothing to price, too many hours, a late holiday

A weekend only request:

```
POST /requests   {"startDate":"2026-11-28","endDate":"2026-11-29", ...}
422 {"error":{"code":"NO_WORKING_DAYS","message":"2026-11-28 to 2026-11-29 has no working day for emp_6601"}}
```

Both days are `NON_WORKDAY`, the total is 0, nothing is written, no audit row. The same happens for a request that is only 2026-12-25 (a holiday).

Too many hours for the range:

```
POST /requests   {"startDate":"2026-11-23","endDate":"2026-11-27","hours":"30", ...}
422 {"error":{"code":"HOURS_TOO_LARGE","message":"30.0000 hours requested, the range holds 24.0000 hours of scheduled work"}}
```

Sending `"hours":"12"` instead is accepted as a partial request, stored with source `GIVEN` and the same breakdown for reference.

A holiday added later: the admin adds 2026-11-25 "Company day off" to the calendar, inside the approved request. The request still shows 24.0000 and its stored breakdown still has three work days. A new request for that range would now price at 16.0000. Correcting the approved one is an admin adjustment of +8.0000 with a reason, so the ledger shows both the debit and the fix. The late holiday leaves one audit row `HOLIDAY_SET` with the date and name.
