# work-hours-and-holidays: planning

## 1. Functional knowledge

The brief assumes a standard day (Monday to Friday, 8 hours) and then asks two things: what if someone works 6 hour days, and what if the company has holidays that must not count against time off. Both answer the same question: how many hours does a request for a range of dates actually cost this employee?

Until now the caller typed the total. This feature makes the server work it out from the employee's work schedule (hours per day, which days of the week) and the holiday calendar that applies to them, and records how it got the number. Holidays are skipped, days off the schedule are skipped, and each remaining day costs that day's hours.

Needs requests (the thing being priced), the ledger (a request still spends hours, nothing about spending changes) and policies. Wrong if reordered: before requests there is nothing to price, and a UI built first would hard code weekdays times 8 and then have to be redone.

How day length affects accrual, as the brief asks: rates stay in hours. A time based policy gives 10 hours a month to a 6 hour worker and an 8 hour worker alike, so the 6 hour worker has fewer days of leave, which is what a pay-based benefit does. An hours worked policy already follows the employee, because payroll reports their real hours. A policy meant to be "N days" is written in hours for the group it is assigned to, and groups with a different day length get their own policy. Converting at accrual time was rejected (decision 6).

## 2. Pattern

A pure calculation over dated facts, like tenure: schedules, holidays and the date range go in, a per day breakdown and a total come out. The server runs it for the preview and again at submit, and stores the breakdown with the request so the number can always be explained later.

## 3. Entities

New: `holiday_calendars` (a named set of holidays, one per company can be the default), `holidays` (a date and a name inside a calendar), `employee_work_schedules` (effective dated: hours per day, working weekdays, and which calendar applies).

Changed: `time_off_requests` gets a `computation` column holding the day by day breakdown.

Standard schedule, the fallback when an employee has no schedule row: 8 hours, Monday to Friday, the company's default calendar if there is one.

Not entities: a day of a request (derived), a holiday observance rule such as "fourth Thursday" (the calendar stores dates, admins load a year at a time).

## 4. Access patterns

| ID | Pattern | Key | Heat |
|---|---|---|---|
| C1 | schedule in force for an employee on a date | company_id, employee_id, effective_from desc | per request preview and submit |
| C2 | holidays of one calendar inside a date range | calendar_id, date | per request preview and submit |
| C3 | the company's default calendar | company_id where is_default | per request, when a schedule names no calendar |
| C4 | load, add or remove holidays of a calendar | calendar_id, date | admin, once a year |
| C5 | set a schedule, read the history of one employee | company_id, employee_id | admin, rare |

## 5. Concurrency

Pricing is read only. The submit already runs in one transaction with the overlap constraint, and now reads schedule and holiday rows inside it so a request is priced against one consistent view. Two admins loading the same holidays at once converge: the holiday key is (calendar, date) and the write is an upsert. A schedule row is unique on (company, employee, effective date), setting the same date twice updates it. A holiday added after a request is approved never touches that request: the stored breakdown is the record.

## 6. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | The server prices a request from dates and the employee's schedule. `hours` becomes optional, omitted means full scheduled days | the client sends the total: every client re-implements holidays and 6 hour days, and they drift |
| 2 | A schedule row carries hours per day, working weekdays and the calendar, effective dated | three separate facts with three histories: the same employee change would be three writes |
| 3 | The calendar is per employee through the schedule, with a company default | the calendar on the policy: policies are groups by benefit, not by place, a California and a New York employee share a policy but not holidays |
| 4 | Holidays are skipped, not credited. A request spanning one costs less | charging the holiday and refunding it: an extra ledger entry for nothing |
| 5 | The price is stored with the request as `computation` and never recomputed | recomputing on approval: a holiday added later would silently change an approved request |
| 6 | Accrual rates stay in hours | per employee day based rates converted at accrual: the ledger is in hours, and a schedule change would rewrite what a "day" meant in the past |
| 7 | If the caller sends `hours`, it must fit inside the scheduled capacity of the range, which allows partial days | trusting any number up to 24 a day: it lets a request include weekends and holidays |
| 8 | A range with no working day is rejected (NO_WORKING_DAYS) | accepting a zero hour request: it holds a date range for nothing and blocks real requests through the overlap rule |
| 9 | A preview endpoint returns the same breakdown the submit will use | the client computing a guess: the point of this feature |

## 7. Open questions

1. Moving the default calendar after creation is not supported. A company that wants a different default creates a calendar and sets schedules. Changing the default is a small follow up.
2. Existing requests were priced under the old 24 hours a day cap. They keep their `hours` and have no `computation`.
3. A schedule change dated in the past affects only requests submitted after it. Fixing an old request is an adjustment, as everywhere else.
4. Floating holidays (an employee picks a day) and half day holidays are not modeled. An admin can load a half day holiday as no holiday and let employees request the hours.

## 8. Definition of done

A company with calendar "US" (the default) holding Thursday 2026-11-26 "Thanksgiving", Friday 2026-11-27 "Day after Thanksgiving" and Friday 2026-12-25 "Christmas". Employees: emp_6601 has no schedule row (standard), emp_6602 works 6 hour days Monday to Friday, emp_6603 works Monday to Thursday, 10 hours. All three are on "PTO Standard" (10 hours a month) with enough balance.

1. Preview 2026-11-23 to 2026-11-27 for emp_6601: 24.0000, three work days of 8 hours, 11-26 and 11-27 marked as holidays.
2. Same range for emp_6602: 18.0000. For emp_6603: 30.0000 (Monday to Wednesday, Thursday is a holiday, Friday is not a work day).
3. Submit emp_6601 for that range without `hours`: the request stores 24.0000 and its `computation`, and approving it debits 24.0000.
4. Submit with `hours` 30 for that range: 422 HOURS_TOO_LARGE. With 12: accepted, a partial request.
5. A weekend only range (2026-11-28 to 2026-11-29) and a holiday only range (2026-12-25): 422 NO_WORKING_DAYS.
6. Set emp_6601 to 6 hours from 2026-12-01. Preview 2026-11-30 to 2026-12-02: 20.0000 (8, 6, 6).
7. Add a holiday inside the approved request from step 3. The request still says 24.0000.
8. An employee previewing for another employee id gets 403. Preview for themselves works.
9. Sending the same submit key again returns the stored request with 200, even though no `hours` was sent.
10. The monthly accrual gives emp_6602 the same hours as emp_6601 for the same month.
11. Calendar creation, holiday loads and removals, and schedule changes each leave an audit row with before and after.
12. The earlier suites (ledger, requests, payroll, tenure, year end) still pass. The requests suite is updated where it relied on the 24 hours a day cap.
