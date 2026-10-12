# web-console: dataflow

Scenario: today is 2026-10-12. emp_2201 is on "PTO Standard" (10 hours a month, no `maxNegativeHours`) with a balance of 24.0000. They open My time off in the browser and request two days, Mon 2026-11-02 and Tue 2026-11-03, 8 hours each. The admin is usr_2217.

## Success path: request in the modal, approve in the queue

1. **Session**: the browser holds `{companyId: 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10, userId: emp_2201, role: EMPLOYEE}`. My time off calls `GET /api/me/assignments` and `GET /api/me/balances`. Next rewrites `/api/me/balances` to `http://localhost:4000/me/balances`, and `lib/api.ts` has added the three headers. The bar reads "6 taken, 24 left". The category list holds Vacation only.
2. **Modal opens**: the form makes the idempotency key `req-3b9c...` (a uuid), once.
3. **Fill in**: Reason "family trip", category Vacation, days 2026-11-02 to 2026-11-03, hours 8, minutes 0. `lib/hours.ts` counts 2 weekdays and shows "2 days x 8h 0m = 16h". The form builds the body and parses it with `createRequestBody` from `@repo/shared`.
4. **Submit** (button disabled while in flight): `POST /api/requests` with `{employeeId: "emp_2201", type: "VACATION", startDate: "2026-11-02", endDate: "2026-11-03", hours: "16.0000", reason: "family trip", idempotencyKey: "req-3b9c..."}`. The API answers 201 PENDING. The modal closes, My requests refetches and shows a Pending row. The balance bar still says 24 left, because pending requests hold nothing.
5. **Admin**: usr_2217 opens Requests, tab Pending, sees the row, and clicks Approve. `POST /api/requests/<id>/approve` returns 200 APPROVED. The row moves to the Approved tab. The ledger gets a `TIME_OFF` entry of -16.0000 and the balance is 8.0000.
6. **Employee**: on the next load the bar reads "22 taken, 8 left" and the request shows Approved with the cancel action, available until the start date.

## Failure path: double click, and an approval that does not fit

The employee double clicks Submit. The second call carries the same key, the API finds the stored request and answers 200 with it, so there is still one row. If the first call timed out on the network, the form shows "Could not reach the server, try again". Pressing Submit again is a safe replay, not a duplicate.

A second request B (Mon 2026-11-09 to Tue 2026-11-10, 16 hours) is pending too. The admin approves B while the balance is 8.0000.

```
POST /api/requests/<B>/approve
422 {"error":{"code":"INSUFFICIENT_BALANCE","message":"approving needs 16.0000 hours, available 8.0000"}}
```

`lib/api.ts` turns this into an `ApiError`. The Requests row shows "INSUFFICIENT_BALANCE: approving needs 16.0000 hours, available 8.0000" in place, B stays Pending, and the list refetches. Nothing was written, so nothing changed on screen except the message. The admin can reject B with a reason, or wait for the November 1 accrual and approve again. If two admins click at the same moment, the loser gets this message or the same 200, which is the API's rule and not something the UI decides.

An employee session that opens `/policies` sees "This page is for admins" from `AdminOnly`. If they call the API directly, they get 403 `FORBIDDEN`.
