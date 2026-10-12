# web-console: techspec

## Version targets

Checked 2026-10-12. Next 16.3.8, React 19.2.8, TypeScript 7.0.2, Node 24, Express 5.3.0, Prisma 7.10.0, PostgreSQL 18, all already in the repo. One new workspace link, `@repo/shared`, in `apps/web`. No other packages.

## Problem statement

Gives admins a console for policies, assignments, requests, balances, operations and the audit log, and gives employees a page to see their balance and request time off. It adds four read endpoints to the API and one web app. It changes no business rule.

## Requirements

- Auth, ids, dates, hours and error shape are the same as the API. The browser sends `x-company-id`, `x-user-id`, `x-role` from the session on every call.
- The web app never writes to anything but the API. No new tables, no migration.
- A failed call shows the API's `code` and `message`. No screen invents its own wording for a server rule.
- Admin pages refuse an employee session on screen. The API keeps enforcing it.

## API additions

| Endpoint | Role | Success | Specific errors |
|---|---|---|---|
| GET /audit-events?entityType=&entityId=&action=&limit=&beforeId= | admin | 200 `{events[], nextBeforeId}` | |
| GET /policies/:id/assignments | admin | 200 `{assignments[]}` | 404 NOT_FOUND |
| GET /me/assignments | any | 200 `{assignments[]}` | |
| GET /me/balances | any | 200, same shape as `/employees/:id/balances` | |
| GET /me/ledger?policyId= | any | 200, same shape as `/employees/:id/ledger` | |

Audit event: `{id, actorId, actorRole, action, entityType, entityId, before, after, reason, createdAt}`. Newest first by `id` (uuidv7 sorts by time). `limit` is 1 to 100, default 50. `beforeId` returns events with a smaller id. `nextBeforeId` is the last id of a full page, otherwise null. Scoped to the caller's company.

Policy assignments: the same fields as the existing assignment shape, ended ones included, ordered by `effectiveFrom` descending. `/me/assignments` returns the assignments of `x-user-id` that are active today, each with `{policyId, policyName, type, accrual, effectiveFrom, effectiveTo}` where `accrual` is `UNLIMITED`, `TIME` or `HOURS_WORKED` from the version in force today.

`/me/balances` and `/me/ledger` call the same service functions as the employee routes, with `ctx.userId` as the employee id. For an employee that is always their own data.

Mounts: `app.use("/audit-events", requireAdmin, auditRouter)`, `app.use("/me", requireUser, meRouter)`. The policy assignments route joins `policiesRouter`.

Shared schemas in `packages/shared/src/audit.ts`, exported as `./audit`:

```ts
import { z } from "zod";

export const listAuditQuery = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.guid().optional(),
  action: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: z.guid().optional(),
});
```

`audit.ts` in `lib/` gets no change. The read is a new `services/audit.ts` (`listAuditEvents`).

## Web app

```
apps/web
  next.config.js          rewrite /api/:path* to the API
  app/layout.tsx          shell: header, session switcher, nav by role, demo banner
  app/page.tsx            sends ADMIN to /policies, EMPLOYEE to /time-off
  app/policies/page.tsx   U1, U2
  app/requests/page.tsx   U3
  app/employees/page.tsx  U4, takes ?id=
  app/operations/page.tsx U5
  app/audit/page.tsx      U6
  app/time-off/page.tsx   U7
  lib/session.tsx         provider, useSession, localStorage in try/catch
  lib/api.ts              fetch wrapper, ApiError {status, code, message}
  lib/use-api.ts          useApi(path) returns {data, error, loading, refetch}
  lib/hours.ts            weekdays between two dates, minutes to a 4 decimal hours string, hours to days
  components/             Modal, Toast, PolicyCard, PolicyForm, AssignmentsDrawer, RequestModal,
                          BalanceBar, LedgerTable, AuditTable, AdminOnly
```

All pages are client components. The rewrite:

```js
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*` }];
  },
};
export default nextConfig;
```

Session: `{companyId, userId, role}` in localStorage under one key. The header shows three fields and a Switch control, plus the line "Demo session: the API trusts these headers. Production sits behind real authentication." Without a valid session every page shows the session form.

`lib/api.ts`: `api<T>(path, {method, body})` adds the three headers and the content type, parses the error shape into `ApiError`, and treats a network failure as `ApiError(0, "NETWORK", ...)`.

## Screen rules

- **Policies.** Card fields come from the version in force: schedule (monthly for TIME, per hours worked for HOURS_WORKED), rate (`10 hours per month`, `1 hour per 30 worked`, `Unlimited`), tiers as extra lines, carryover cap, negative floor, accrual timing "End of period" (the ledger accrues in arrears), unit "Hour". New Policy and Edit Policy use one form: kind picker, rate fields, tiers editor (TIME only), max negative, carryover. The form builds the config and parses it with `policyConfigSchema` before sending. Edit Policy posts a version with `effectiveFrom` (default today) and a required reason, and warns that posted entries do not change.
- **Manage assignments.** Table of assignments with an End action (date picker, `effectiveTo` exclusive, shown as such). Assign takes employee ids separated by commas or spaces and a date, split client side, up to 500.
- **My time off.** One bar per assigned policy: taken (sum of `TIME_OFF` and reversals this calendar year), left (balance), floor. UNLIMITED shows "Unlimited". The Request modal has Reason (required), Category (assigned types only), Days (start and end date), Hours and Minutes per day. The total is `weekdays in range x (hours, minutes)`, shown as arithmetic ("2 days x 8h 0m = 16h"), sent as a 4 decimal string. The idempotency key is a uuid made when the modal opens.
- **Requests queue.** Tabs by status, rows with employee, type, dates, hours, reason. Approve and Reject (reason required) on pending rows. Cancel on approved ones that start after today. An error stays on its row.
- **Employee lookup.** Balances, assignments, the ledger (newest first, `detail` expands, tier segments shown as "9 days at 10, 22 days at 12"), start date edit, adjustment form (`hours` with sign, reason, idempotency key made on open).
- **Operations.** Three cards: monthly accrual (month picker), payroll accrual (period and a pasted `employeeId,hoursWorked` list, one per line, parsed to the body), year-end (year picker). Results show the counts the API returns. `mismatched` payroll rows render as a table.
- **Audit.** Filters, a table with the action, entity, actor, time and a JSON diff of `before` and `after`, Load more with `nextBeforeId`.

## Seed

`apps/api/scripts/seed-demo.sh` creates a fresh company and prints the three header values to paste into the session form. It makes the three policies from the definition of done, assigns emp_2201 and emp_2202, sets start dates, runs accruals for the last three finished months, and submits one pending request. It follows the style of the existing test scripts.

## Build order

1. API reads, shared audit schema, seed script.
2. Web foundation: rewrite, session, api client, layout, `@repo/shared` link.
3. Policies page: list, New Policy, Edit Policy.
4. Manage assignments.
5. Employee page: balances, request modal, my requests.
6. Requests queue.
7. Employee lookup.
8. Operations.
9. Audit viewer.
10. Polish, build, final walkthrough.

## Edge cases

- API down or the rewrite target wrong: a banner with the failed path, pages stay usable.
- A 401 from the API (bad session): back to the session form with the message.
- Employee session with no assignments: My time off says nothing is assigned and the Request button is off.
- Request range with only weekend days: total 0, submit is off.
- Hours and minutes of 0 and 0: submit off. Minutes above 59 are rejected in the form.
- Range of 20 minutes a day over 3 days: 60 minutes, sent as "1.0000".
- The server's 24 hours a day cap, overlap and not assigned errors show as the API words them.
- A policy with no tiers or carryover renders without those lines.
- A very long employee list on assign: split and sent as one call, 500 max, the API's validation error is shown if exceeded.
- Two tabs with different sessions: each tab reads its own localStorage on load only, switching in one does not hot swap the other.
- localStorage unavailable: the session lives in memory for the tab.

## Non-goals

No real authentication, no server rendering of data, no employee directory. No holidays or custom work hours in the UI (those features are not built yet, the form total is the stopgap). No calendar view, no notifications, no dark mode, no i18n. No automated browser tests, the walkthrough in the planning doc is the check. No pagination except the audit log.
