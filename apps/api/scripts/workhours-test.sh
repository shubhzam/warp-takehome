#!/usr/bin/env bash
# end to end check for work hours and holidays - run from the repo root with the api up on :4000
# needs jq and docker compose. uses a fresh company id every run so reruns never collide
# dates are hard coded around the week of 2026-11-23, the accruals need 2026-09 to be over (today is 2026-10-12)
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }
FAILS=0

# as ADMIN or as <employeeId> sets the headers for the next calls
as() {
  if [ "$1" = ADMIN ]; then
    H=(-H "x-company-id: $CO" -H "x-user-id: usr_2217" -H "x-role: ADMIN" -H "content-type: application/json")
  else
    H=(-H "x-company-id: $CO" -H "x-user-id: $1" -H "x-role: EMPLOYEE" -H "content-type: application/json")
  fi
}

# api <method> <path> [json body] - the body goes to $LAST and the status to $CODE
api() {
  local out
  if [ -n "$3" ]; then
    out=$(curl -s -w '\n%{http_code}' "${H[@]}" -X "$1" "$BASE$2" -d "$3")
  else
    out=$(curl -s -w '\n%{http_code}' "${H[@]}" -X "$1" "$BASE$2")
  fi
  CODE=${out##*$'\n'}
  LAST=${out%$'\n'*}
}

# expect <label> <actual> <expected> - prints ok or FAIL and counts the failures for the exit code
expect() {
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    echo "     expected: $3"
    echo "     got:      $2"
    FAILS=$((FAILS + 1))
  fi
}

# body of a request, hours is left out when the fourth argument is empty
# sub <employee> <start> <end> <hours or ""> <key>
sub() {
  jq -nc --arg e "$1" --arg s "$2" --arg d "$3" --arg h "$4" --arg k "$5" \
    '{employeeId: $e, type: "VACATION", startDate: $s, endDate: $d, reason: "time off", idempotencyKey: $k} + (if $h == "" then {} else {hours: $h} end)'
}

hours_of() { as ADMIN; api GET /employees/$1/balances; jq -r '.[0].hours // "none"' <<<"$LAST"; }
show() { for e in emp_6601 emp_6602 emp_6603; do echo "$e: $(hours_of $e)"; done; }
audit_count() { as ADMIN; api GET "/audit-events?action=$1&limit=100"; jq -r '.events | length' <<<"$LAST"; }

echo "--- setup: PTO Standard (10 a month), US default calendar with 3 holidays, 3 employees"
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_6601','emp_6602','emp_6603');" > /dev/null
as ADMIN
api POST /policies '{"name":"PTO Standard","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}'
PTO=$(jq -r .policy.id <<<"$LAST")
api POST /policies/$PTO/assignments '{"employeeIds":["emp_6601","emp_6602","emp_6603"],"effectiveFrom":"2026-01-01"}'
echo "policy=$PTO assignments=$CODE"

api POST /holiday-calendars '{"name":"US","isDefault":true}'
CAL=$(jq -r .id <<<"$LAST")
api PUT /holiday-calendars/$CAL/holidays '{"holidays":[{"date":"2026-11-26","name":"Thanksgiving"},{"date":"2026-11-27","name":"Day after Thanksgiving"},{"date":"2026-12-25","name":"Christmas"}]}'
echo "calendar=$CAL holidays: $LAST"
# emp_6601 has no schedule row on purpose, it works the standard week
api PUT /employees/emp_6602/work-schedule '{"effectiveFrom":"2026-01-01","hoursPerDay":"6","workDays":[1,2,3,4,5]}'
api PUT /employees/emp_6603/work-schedule '{"effectiveFrom":"2026-01-01","hoursPerDay":"10","workDays":[1,2,3,4]}'
for m in 2026-05 2026-06 2026-07 2026-08; do api POST /accrual-runs "{\"period\":\"$m\"}"; done
show

echo; echo "--- 1. preview emp_6601 for 2026-11-23 to 11-27 - expect 24.0000, three work days of 8 hours, 11-26 and 11-27 holidays"
as emp_6601
api GET "/requests/preview?employeeId=emp_6601&startDate=2026-11-23&endDate=2026-11-27"
jq -c '{hours, days: [.days[] | {date, kind, hours, holidayName}]}' <<<"$LAST"
expect "1 status" "$CODE" "200"
expect "1 total" "$(jq -r .hours <<<"$LAST")" "24.0000"
expect "1 kinds" "$(jq -r '[.days[].kind] | join(",")' <<<"$LAST")" "WORKDAY,WORKDAY,WORKDAY,HOLIDAY,HOLIDAY"
expect "1 day cost" "$(jq -r '[.days[].hours] | join(",")' <<<"$LAST")" "8.0000,8.0000,8.0000,0.0000,0.0000"
expect "1 holiday names" "$(jq -r '[.days[] | select(.holidayName) | .holidayName] | join("|")' <<<"$LAST")" "Thanksgiving|Day after Thanksgiving"

echo; echo "--- 2. same range for emp_6602 and emp_6603 - expect 18.0000 and 30.0000 (thursday holiday, friday not a work day)"
as ADMIN
api GET "/requests/preview?employeeId=emp_6602&startDate=2026-11-23&endDate=2026-11-27"
expect "2 emp_6602 total" "$(jq -r .hours <<<"$LAST")" "18.0000"
api GET "/requests/preview?employeeId=emp_6603&startDate=2026-11-23&endDate=2026-11-27"
expect "2 emp_6603 total" "$(jq -r .hours <<<"$LAST")" "30.0000"
expect "2 emp_6603 kinds" "$(jq -r '[.days[].kind] | join(",")' <<<"$LAST")" "WORKDAY,WORKDAY,WORKDAY,HOLIDAY,NON_WORKDAY"

echo; echo "--- 3. emp_6601 submits the range without hours - expect 201, 24.0000 with its computation, approval debits 24.0000"
as emp_6601
api POST /requests "$(sub emp_6601 2026-11-23 2026-11-27 "" wh-main)"
REQ=$(jq -r .id <<<"$LAST")
jq -c '{status, hours, source: .computation.source, scheduledHours: .computation.scheduledHours, days: (.computation.days | length)}' <<<"$LAST"
expect "3 status" "$CODE" "201"
expect "3 hours" "$(jq -r .hours <<<"$LAST")" "24.0000"
expect "3 source" "$(jq -r .computation.source <<<"$LAST")" "COMPUTED"
expect "3 scheduled" "$(jq -r .computation.scheduledHours <<<"$LAST")" "24.0000"
expect "3 stored breakdown" "$(jq -r '[.computation.days[].kind] | join(",")' <<<"$LAST")" "WORKDAY,WORKDAY,WORKDAY,HOLIDAY,HOLIDAY"
as ADMIN
api POST /requests/$REQ/approve '{}'
expect "3 approved" "$(jq -r .status <<<"$LAST")" "APPROVED"
expect "3 balance after" "$(hours_of emp_6601)" "16.0000"
api GET /employees/emp_6601/ledger
expect "3 one debit" "$(jq -r '[.[] | select(.kind == "TIME_OFF") | .hours] | join(",")' <<<"$LAST")" "-24.0000"

echo; echo "--- 4. hours 30 for that range - expect 422 HOURS_TOO_LARGE, and hours 12 accepted as a partial request"
as emp_6601
api POST /requests "$(sub emp_6601 2026-11-23 2026-11-27 30 wh-big)"
jq -c .error <<<"$LAST"
expect "4 status" "$CODE" "422"
expect "4 code" "$(jq -r .error.code <<<"$LAST")" "HOURS_TOO_LARGE"
expect "4 message" "$(jq -r .error.message <<<"$LAST")" "30.0000 hours requested, the range holds 24.0000 hours of scheduled work"
# emp_6601 already has that range approved, so the partial request goes to emp_6602 who holds 18 hours there
as emp_6602
api POST /requests "$(sub emp_6602 2026-11-23 2026-11-27 12 wh-part)"
jq -c '{status, hours, source: .computation.source, scheduledHours: .computation.scheduledHours}' <<<"$LAST"
expect "4 partial status" "$CODE" "201"
expect "4 partial hours" "$(jq -r .hours <<<"$LAST")" "12.0000"
expect "4 partial source" "$(jq -r .computation.source <<<"$LAST")" "GIVEN"
expect "4 partial capacity" "$(jq -r .computation.scheduledHours <<<"$LAST")" "18.0000"
as emp_6602
api POST /requests "$(sub emp_6602 2026-11-30 2026-12-04 30.0001 wh-big2)"
expect "4 just over the week" "$(jq -r .error.code <<<"$LAST")" "HOURS_TOO_LARGE"
api POST /requests "$(sub emp_6602 2026-11-30 2026-12-04 30 wh-exact)"
expect "4 exactly the week" "$CODE" "201"

echo; echo "--- 5. weekend only and holiday only - expect 422 NO_WORKING_DAYS twice and no request written"
as emp_6601
api POST /requests "$(sub emp_6601 2026-11-28 2026-11-29 "" wh-weekend)"
jq -c .error <<<"$LAST"
expect "5 weekend code" "$(jq -r .error.code <<<"$LAST")" "NO_WORKING_DAYS"
expect "5 weekend status" "$CODE" "422"
api POST /requests "$(sub emp_6601 2026-12-25 2026-12-25 "" wh-xmas)"
expect "5 holiday code" "$(jq -r .error.code <<<"$LAST")" "NO_WORKING_DAYS"
api POST /requests "$(sub emp_6601 2026-12-25 2026-12-25 8 wh-xmas8)"
expect "5 holiday with hours" "$(jq -r .error.code <<<"$LAST")" "NO_WORKING_DAYS"
api GET /requests
expect "5 emp_6601 has one request" "$(jq -r length <<<"$LAST")" "1"
expect "5 request audit rows" "$(audit_count REQUEST_CREATED)" "3"

echo; echo "--- 6. emp_6601 moves to 6 hours from 2026-12-01 - expect preview of 11-30 to 12-02 to be 20.0000 (8, 6, 6)"
as ADMIN
api PUT /employees/emp_6601/work-schedule '{"effectiveFrom":"2026-12-01","hoursPerDay":"6","workDays":[1,2,3,4,5]}'
expect "6 schedule saved" "$CODE" "200"
as emp_6601
api GET "/requests/preview?employeeId=emp_6601&startDate=2026-11-30&endDate=2026-12-02"
jq -c '{hours, days: [.days[] | {date, kind, hours}]}' <<<"$LAST"
expect "6 total" "$(jq -r .hours <<<"$LAST")" "20.0000"
expect "6 day cost" "$(jq -r '[.days[].hours] | join(",")' <<<"$LAST")" "8.0000,6.0000,6.0000"

echo; echo "--- 7. holiday 2026-11-25 added inside the approved request - expect it still says 24.0000, a new preview says 16.0000"
as ADMIN
api PUT /holiday-calendars/$CAL/holidays '{"holidays":[{"date":"2026-11-25","name":"Company day off"}]}'
expect "7 holiday added" "$(jq -cS . <<<"$LAST")" '{"added":1,"unchanged":0,"updated":0}'
as emp_6601
api GET /requests/$REQ
expect "7 hours unchanged" "$(jq -r .hours <<<"$LAST")" "24.0000"
expect "7 stored work days" "$(jq -r '[.computation.days[] | select(.kind == "WORKDAY")] | length' <<<"$LAST")" "3"
api GET "/requests/preview?employeeId=emp_6601&startDate=2026-11-23&endDate=2026-11-27"
expect "7 new preview" "$(jq -r .hours <<<"$LAST")" "16.0000"
expect "7 balance untouched" "$(hours_of emp_6601)" "16.0000"

echo; echo "--- 8. preview for someone else - expect 403 for the employee, 200 for themselves and for an admin"
as emp_6601
api GET "/requests/preview?employeeId=emp_6602&startDate=2026-11-23&endDate=2026-11-27"
expect "8 other employee" "$CODE" "403"
api GET "/requests/preview?employeeId=emp_6601&startDate=2026-11-23&endDate=2026-11-27"
expect "8 themselves" "$CODE" "200"
as ADMIN
api GET "/requests/preview?employeeId=emp_6602&startDate=2026-11-23&endDate=2026-11-27"
expect "8 admin" "$CODE" "200"

echo; echo "--- 9. same submit key again, no hours sent - expect 200 and the stored request, although a repricing would say 16.0000"
as emp_6601
api POST /requests "$(sub emp_6601 2026-11-23 2026-11-27 "" wh-main)"
echo "$CODE $(jq -c '{id, hours, status}' <<<"$LAST")"
expect "9 status" "$CODE" "200"
expect "9 same id" "$(jq -r .id <<<"$LAST")" "$REQ"
expect "9 stored hours" "$(jq -r .hours <<<"$LAST")" "24.0000"
api POST /requests "$(sub emp_6601 2026-11-30 2026-12-04 "" wh-main)"
expect "9 same key other dates" "$(jq -r .error.code <<<"$LAST")" "IDEMPOTENCY_KEY_REUSED"
api POST /requests "$(sub emp_6601 2026-11-23 2026-11-27 12 wh-main)"
expect "9 same key other hours" "$(jq -r .error.code <<<"$LAST")" "IDEMPOTENCY_KEY_REUSED"

echo; echo "--- 10. accrual for 2026-09 - expect 10.0000 for all three, the 6 hour worker gets what the 8 hour worker gets"
as ADMIN
api POST /accrual-runs '{"period":"2026-09"}'
echo "$LAST"
for e in emp_6601 emp_6602 emp_6603; do
  api GET /employees/$e/ledger
  expect "10 $e accrual 2026-09" "$(jq -r '[.[] | select(.kind == "ACCRUAL" and .period == "2026-09") | .hours] | join(",")' <<<"$LAST")" "10.0000"
done
echo "balances: expect 26.0000 (40 - 24 + 10) / 50.0000 / 50.0000"
show

echo; echo "--- 11. audit - expect a row with before and after for each calendar, holiday and schedule change"
as ADMIN
# a renamed holiday, loading it again, a removed holiday and a changed schedule row
api PUT /holiday-calendars/$CAL/holidays '{"holidays":[{"date":"2026-11-25","name":"Company shutdown"}]}'
expect "11 holiday renamed" "$(jq -cS . <<<"$LAST")" '{"added":0,"unchanged":0,"updated":1}'
api PUT /holiday-calendars/$CAL/holidays '{"holidays":[{"date":"2026-11-25","name":"Company shutdown"}]}'
expect "11 same load again" "$(jq -cS . <<<"$LAST")" '{"added":0,"unchanged":1,"updated":0}'
api DELETE /holiday-calendars/$CAL/holidays/2026-11-25
expect "11 holiday removed" "$(jq -cS . <<<"$LAST")" '{"date":"2026-11-25","name":"Company shutdown"}'
api PUT /employees/emp_6601/work-schedule '{"effectiveFrom":"2026-12-01","hoursPerDay":"7","workDays":[1,2,3,4,5]}'
api PUT /employees/emp_6601/work-schedule '{"effectiveFrom":"2026-12-01","hoursPerDay":"7.0000","workDays":[5,4,3,2,1]}'

expect "11 calendar created rows" "$(audit_count HOLIDAY_CALENDAR_CREATED)" "1"
expect "11 holiday set rows" "$(audit_count HOLIDAY_SET)" "5"
expect "11 holiday removed rows" "$(audit_count HOLIDAY_REMOVED)" "1"
expect "11 schedule rows" "$(audit_count WORK_SCHEDULE_SET)" "4"

api GET "/audit-events?action=HOLIDAY_CALENDAR_CREATED"
expect "11 calendar after" "$(jq -cS '.events[0].after' <<<"$LAST")" '{"isDefault":true,"name":"US"}'
api GET "/audit-events?action=HOLIDAY_SET&limit=2"
jq -c '.events[] | {action, entityType, before, after}' <<<"$LAST"
expect "11 rename before" "$(jq -cS '.events[0].before' <<<"$LAST")" '{"date":"2026-11-25","name":"Company day off"}'
expect "11 rename after" "$(jq -cS '.events[0].after' <<<"$LAST")" '{"date":"2026-11-25","name":"Company shutdown"}'
expect "11 holiday entity" "$(jq -r '.events[0].entityId' <<<"$LAST")" "$CAL"
api GET "/audit-events?action=HOLIDAY_REMOVED"
expect "11 removed before" "$(jq -cS '.events[0].before' <<<"$LAST")" '{"date":"2026-11-25","name":"Company shutdown"}'
api GET "/audit-events?action=WORK_SCHEDULE_SET&limit=1"
jq -c '.events[] | {action, entityType, before, after}' <<<"$LAST"
expect "11 schedule before" "$(jq -r '.events[0].before.hoursPerDay' <<<"$LAST")" "6.0000"
expect "11 schedule after" "$(jq -r '.events[0].after.hoursPerDay' <<<"$LAST")" "7.0000"
api GET "/audit-events?action=WORK_SCHEDULE_SET&limit=100"
expect "11 first sets have no before" "$(jq -r '[.events[] | select(.before == null)] | length' <<<"$LAST")" "3"

echo; echo "--- extra: guards - expect 409 DUPLICATE_NAME, 409 DEFAULT_EXISTS, 404 for an unknown calendar, 403 for an employee"
api POST /holiday-calendars '{"name":"US"}'
expect "extra duplicate name" "$(jq -r .error.code <<<"$LAST")" "DUPLICATE_NAME"
api POST /holiday-calendars '{"name":"EU","isDefault":true}'
expect "extra second default" "$(jq -r .error.code <<<"$LAST")" "DEFAULT_EXISTS"
api PUT /employees/emp_6601/work-schedule '{"effectiveFrom":"2026-02-01","hoursPerDay":"8","workDays":[1],"calendarId":"00000000-0000-4000-8000-000000000000"}'
expect "extra unknown calendar" "$CODE" "404"
api PUT /holiday-calendars/00000000-0000-4000-8000-000000000000/holidays '{"holidays":[{"date":"2026-12-25","name":"Christmas"}]}'
expect "extra unknown calendar holidays" "$CODE" "404"
as emp_6601
api GET /holiday-calendars
expect "extra employee calendars" "$CODE" "403"
api PUT /employees/emp_6601/work-schedule '{"effectiveFrom":"2026-02-01","hoursPerDay":"8","workDays":[1]}'
expect "extra employee schedule" "$CODE" "403"

echo; echo "--- 12. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id WHERE b.employee_id IN ('emp_6601','emp_6602','emp_6603') GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"

echo; echo "--- 13. ledger by kind for this company: expect ACCRUAL 15 / 150, TIME_OFF 1 / -24 and nothing else"
psql_run "SELECT kind, count(*), sum(hours) FROM ledger_entries WHERE company_id = '$CO' GROUP BY kind ORDER BY kind;"

echo
if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS check(s) failed"
  exit 1
fi
echo "all checks passed"
