#!/usr/bin/env bash
# demo data for the web console - run from the repo root with the api up on :4000
# needs jq and docker compose. makes a fresh company and prints the session values to paste into the console
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
ADM=(-H "x-company-id: $CO" -H "x-user-id: admin_1" -H "x-role: ADMIN" -H "content-type: application/json")
EMP=(-H "x-company-id: $CO" -H "x-user-id: emp_2201" -H "x-role: EMPLOYEE" -H "content-type: application/json")
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }
post() { curl -s "${ADM[@]}" -X POST "$BASE$1" -d "$2"; }

# the assignment overlap constraint has no company column, so clear earlier runs of these employees
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_2201','emp_2202');" > /dev/null

echo "creating policies"
PTO=$(post /policies '{"name":"PTO Standard","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10","tiers":[{"afterYears":2,"hoursPerMonth":"12"},{"afterYears":5,"hoursPerMonth":"15"}]},"maxNegativeHours":"8","carryover":{"maxHours":"8"}}}' | jq -r .policy.id)
SICK=$(post /policies '{"name":"Sick Earned","type":"SICK","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"HOURS_WORKED","earnHours":"1","perHoursWorked":"30"}}}' | jq -r .policy.id)
PARENTAL=$(post /policies '{"name":"Parental Leave","type":"PARENTAL","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"UNLIMITED"}}}' | jq -r .policy.id)

echo "assigning emp_2201 and emp_2202"
for p in "$PTO" "$SICK" "$PARENTAL"; do
  post "/policies/$p/assignments" '{"employeeIds":["emp_2201","emp_2202"],"effectiveFrom":"2026-01-01"}' > /dev/null
done

echo "start dates"
curl -s "${ADM[@]}" -X PUT $BASE/employees/emp_2201/start-date -d '{"startDate":"2024-03-10"}' > /dev/null
curl -s "${ADM[@]}" -X PUT $BASE/employees/emp_2202/start-date -d '{"startDate":"2021-01-15"}' > /dev/null

echo "default calendar US with three holidays, and a 6 hour week for emp_2202"
CAL=$(post /holiday-calendars '{"name":"US","isDefault":true}' | jq -r .id)
curl -s "${ADM[@]}" -X PUT $BASE/holiday-calendars/$CAL/holidays -d '{"holidays":[{"date":"2026-11-26","name":"Thanksgiving"},{"date":"2026-11-27","name":"Day after Thanksgiving"},{"date":"2026-12-25","name":"Christmas"}]}' > /dev/null
curl -s "${ADM[@]}" -X PUT $BASE/employees/emp_2202/work-schedule -d '{"effectiveFrom":"2026-01-01","hoursPerDay":"6","workDays":[1,2,3,4,5]}' > /dev/null

echo "accruals for 2026-07, 2026-08, 2026-09 and one payroll period"
for m in 2026-07 2026-08 2026-09; do post /accrual-runs "{\"period\":\"$m\"}" > /dev/null; done
post /payroll-accruals '{"periodStart":"2026-09-01","periodEnd":"2026-09-30","entries":[{"employeeId":"emp_2201","hoursWorked":"160"},{"employeeId":"emp_2202","hoursWorked":"120"}]}' > /dev/null

echo "one pending request from emp_2201"
curl -s "${EMP[@]}" -X POST $BASE/requests -d '{"employeeId":"emp_2201","type":"VACATION","startDate":"2026-11-02","endDate":"2026-11-03","hours":"16","reason":"family trip","idempotencyKey":"seed-req-1"}' > /dev/null

echo
echo "session values for the console:"
echo "  company id: $CO"
echo "  admin:      user admin_1, role ADMIN"
echo "  employee:   user emp_2201, role EMPLOYEE"
echo
echo "balances of emp_2201:"
curl -s "${ADM[@]}" $BASE/employees/emp_2201/balances | jq -c '.[] | {policyName, hours}'
