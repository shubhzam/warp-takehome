#!/usr/bin/env bash
# end to end check for tenure tiers - run from the repo root with the api up on :4000
# needs jq and docker compose. uses a fresh company id every run so reruns never collide
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
H=(-H "x-company-id: $CO" -H "x-user-id: admin_1" -H "x-role: ADMIN" -H "content-type: application/json")
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }
call() { curl -s -w ' [%{http_code}]\n' "${H[@]}" "$@"; }
show() { for e in emp_5501 emp_5502 emp_5503; do echo -n "$e: "; curl -s "${H[@]}" $BASE/employees/$e/balances | jq -c '[.[] | {policy: .policyName, hours}]'; done; }

# the assignment overlap constraint has no company column, so clear earlier runs of these employees
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_5501','emp_5502','emp_5503');"

echo "--- setup: one policy with tiers at 2 and 5 years, three employees assigned from 2026-01-01"
POL=$(curl -s "${H[@]}" -X POST $BASE/policies -d '{"name":"PTO Tenure","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10","tiers":[{"afterYears":2,"hoursPerMonth":"12"},{"afterYears":5,"hoursPerMonth":"15"}]}}}' | jq -r .policy.id)
echo "policy=$POL"
call -X POST $BASE/policies/$POL/assignments -d '{"employeeIds":["emp_5501","emp_5502","emp_5503"],"effectiveFrom":"2026-01-01"}' | cut -c1-120

echo; echo "--- 1. start dates: set 5501 and 5502, 5503 has none - expect two 200s then null"
call -X PUT $BASE/employees/emp_5501/start-date -d '{"startDate":"2024-03-10"}'
call -X PUT $BASE/employees/emp_5502/start-date -d '{"startDate":"2021-01-15"}'
call $BASE/employees/emp_5503/start-date

echo; echo "--- 2. bad configs - expect two 400s"
call -X POST $BASE/policies -d '{"name":"bad order","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10","tiers":[{"afterYears":5,"hoursPerMonth":"15"},{"afterYears":2,"hoursPerMonth":"12"}]}}}' | cut -c1-160
call -X POST $BASE/policies -d '{"name":"bad kind","type":"SICK","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"HOURS_WORKED","earnHours":"1","perHoursWorked":"30","tiers":[{"afterYears":2,"hoursPerMonth":"12"}]}}}' | cut -c1-160

echo; echo "--- 3. run 2026-03 - expect created 3, balances 11.4194 / 15.0000 / 10.0000"
call -X POST $BASE/accrual-runs -d '{"period":"2026-03"}'
show

echo; echo "--- 4. emp_5501 entry detail - expect 9 days at 10 (tenure 1), 22 days at 12 (tenure 2)"
curl -s "${H[@]}" "$BASE/employees/emp_5501/ledger?policyId=$POL" | jq -c '.[] | {kind, hours, segments: .detail.segments}'

echo; echo "--- 5. change emp_5503 start to 2020-06-01, rerun 2026-03 - expect created 0, alreadyAccrued 3, balances unchanged"
call -X PUT $BASE/employees/emp_5503/start-date -d '{"startDate":"2020-06-01"}'
call -X POST $BASE/accrual-runs -d '{"period":"2026-03"}'
show

echo; echo "--- 6. run 2026-04 - the new date counts now, expect 23.4194 / 30.0000 / 25.0000"
call -X POST $BASE/accrual-runs -d '{"period":"2026-04"}'
show

echo; echo "--- 7. audit - expect 3 EMPLOYEE_START_DATE_SET rows for this company"
AUD=$(docker compose exec -T postgres psql -U warp -d timeoff -Atc "SELECT tablename FROM pg_tables WHERE tablename LIKE 'audit%' LIMIT 1")
psql_run "SELECT action, after->>'employeeId' AS employee, before->>'startDate' AS before, after->>'startDate' AS after FROM $AUD WHERE company_id = '$CO' AND action = 'EMPLOYEE_START_DATE_SET' ORDER BY id;"

echo; echo "--- 8. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id WHERE b.employee_id IN ('emp_5501','emp_5502','emp_5503') GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"