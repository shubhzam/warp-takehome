# web-console: planning

## 1. Functional knowledge

The brief shows two screens: a Time Off page where an admin sees policies (schedule, rate, accrual timing, unit) with Edit Policy and Manage Assignments, and a Request time-off modal where an employee sees what they have left before asking. This feature builds those, and the admin tools around them, on top of the API that already exists. It adds no business rules. Every rule (balance floor, tiers, carryover, idempotency) stays in the API, and the UI shows what the API answers, including its errors.

Needs everything before it: policies, ledger, requests, payroll accrual, tenure and year end. Wrong if reordered: before requests there is nothing to approve, and before the audit log a console that edits policies has no way to show who changed what.

## 2. Pattern

A thin client over a stable API. The browser holds only a session (company, user, role) and fetches through a same-origin proxy. Pages are views of API resources, and every write is followed by a refetch, so the screen never guesses what the server did.

## 3. Entities

No new tables. New read models, all projections of existing data:

- an audit event list (the audit table already exists, nothing reads it yet)
- the assignments of one policy
- the signed in employee's own assignments, balances and ledger (`/me`)

Client-side only: the session `{companyId, userId, role}`, kept in the browser.

Not entities: a page's filters, a draft request, a toast.

## 4. Access patterns

| ID | Screen | Reads | Writes |
|---|---|---|---|
| U1 | Policies (admin) | GET /policies, GET /policies/:id | POST /policies, POST /policies/:id/versions |
| U2 | Manage assignments (admin) | GET /policies/:id/assignments | POST /policies/:id/assignments, PATCH /assignments/:id |
| U3 | Requests queue (admin) | GET /requests?status= | approve, reject |
| U4 | Employee lookup (admin) | balances, ledger, assignments, start date of one employee | adjustment, PUT start date |
| U5 | Operations (admin) | none | accrual run, payroll accrual, year-end run |
| U6 | Audit log (admin) | GET /audit-events | none |
| U7 | My time off (employee) | GET /me/assignments, /me/balances, /me/ledger, GET /requests | POST /requests, cancel |

## 5. Concurrency

The UI cannot make anything safe by itself, so it leans on what the API guarantees. A request form generates its idempotency key when it opens, so a double click or a retry after a timeout is a replay (200), never a second request. Buttons are disabled while a call is in flight. Two admins approving at once get the existing outcomes (one 200, one 422 or the same 200) and the loser sees the API's message and a fresh list. A list never updates itself from a guess: it refetches after every write.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Client components calling the API through a Next rewrite (`/api/*`) | CORS in the API: a new surface to secure for a demo. Server components with cookie sessions: more moving parts than the console needs |
| 2 | The session is three header values kept in localStorage, with a visible demo banner | a login flow: the API trusts headers by design here, production would put Cognito or a JWT in front |
| 3 | Forms validate with the zod schemas from `@repo/shared` | a second copy of the rules in the web app: they would drift |
| 4 | Plain CSS modules plus the existing `@repo/ui` button and card | a component library or Tailwind: a large install for ten screens |
| 5 | Employees read their own data through `/me` | opening `/employees/*` to the employee role: those routes take any id |
| 6 | The audit list pages by id cursor (newest first) | offset paging: rows shift under it while events keep arriving |
| 7 | The request form computes total hours as weekdays x (hours, minutes) in the browser | server side computing: that is the holidays and work hours feature, and it will replace this step |
| 8 | Hours are the unit on screen, with days (8 hour standard day) as a hint | days as the unit: the ledger is in hours, and 6 hour workers would make days ambiguous |
| 9 | A small `useApi` hook with manual refetch | SWR or React Query: a dependency for a few lists |

## 7. Open questions

1. There is no employee directory (the Employee Service owns that). The admin lookup takes an employee id as text, and the policies and requests screens link into it. The console remembers the ids it has seen.
2. The request form cannot know about holidays or 6 hour days yet, so its total can be wrong for those employees. The form shows the arithmetic, so the number is never a surprise, and the API still decides.
3. A header based session means anyone can pick any role in the browser. That is the API's demo trust model, stated on screen.

## 8. Definition of done

A seeded company has: "PTO Standard" (VACATION, TIME 10 a month, tiers at 2 and 5 years, carryover cap 8), "Sick Earned" (SICK, 1 hour per 30 worked), "Remote Days" (VACATION, UNLIMITED). Employees emp_2201 and emp_2202.

1. Admin session. The Policies page shows the three as cards with schedule, rate, accrual timing and unit, like the brief's mockup. Unlimited shows "Unlimited".
2. New Policy creates one of each kind. A tier list that does not ascend is rejected in the form, with the same message the API gives.
3. Edit Policy creates version 2 effective today or later and the card shows it. A past date shows the API's error. The audit page lists `POLICY_VERSION_CREATED` with before and after.
4. Manage Assignments lists, assigns two employees, and ends one. An overlap shows the API's message inline.
5. Employee session (emp_2201). My time off shows a balance bar per policy (taken, left) and the unlimited one. The request modal lists only categories the employee is assigned to, takes a date range and hours and minutes, and shows the total before sending. Submit gives a pending request. Cancel works.
6. Admin Requests queue. Approving lowers the balance. Approving a second request that does not fit shows INSUFFICIENT_BALANCE on that row and the request stays pending. Reject requires a reason.
7. Employee lookup. Balances, the ledger (an accrual row expands to its tier segments), a start date change, and an adjustment with a reason.
8. Operations. A monthly accrual run, a payroll accrual paste, and a year-end run for the current year (422 shown plainly) and for a finished one.
9. Audit log. Filters by entity type and action, and Load more.
10. An employee session opening an admin page sees a clear "admin only" screen, not a broken page.
11. `pnpm check-types` and `pnpm --filter web build` pass.
