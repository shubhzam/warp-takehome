#!/usr/bin/env bash
# end to end check for the year end carryover cap - run from the repo root with the api up on :4000
# needs jq and docker compose. uses a fresh company id every run so reruns never collide
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
H=(-H "x-company-id: $CO" -H "x-user-id: admin_1" -H "x-role: ADMIN" -H "content-type: application/json")
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }
call() { curl -s -w ' [%{http_code}]\n' "${H[@]}" "$@"; }
show() { for e in emp_5511 emp_5512 emp_5513 emp_5514; do echo -n "$e: "; curl -s "${H[@]}" $BASE/employees/$e/balances | jq -c '[.[] | {policy: .policyName, hours}]'; done; }

# the assignment overlap constraint has no company column, so clear earlier runs of these employees
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_5511','emp_5512','emp_5513','emp_5514');"

echo "--- setup: PTO Carry (10 a month, cap 8, floor -8) and PTO Plain (10 a month, no carryover rule)"
CARRY=$(curl -s "${H[@]}" -X POST $BASE/policies -d '{"name":"PTO Carry","type":"VACATION","effectiveFrom":"2025-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"},"maxNegativeHours":"8","carryover":{"maxHours":"8"}}}' | jq -r .policy.id)
PLAIN=$(curl -s "${H[@]}" -X POST $BASE/policies -d '{"name":"PTO Plain","type":"VACATION","effectiveFrom":"2025-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}' | jq -r .policy.id)
echo "carry=$CARRY plain=$PLAIN"
call -X POST $BASE/policies/$CARRY/assignments -d '{"employeeIds":["emp_5511","emp_5513"],"effectiveFrom":"2025-01-01"}' | cut -c1-80
call -X POST $BASE/policies/$CARRY/assignments -d '{"employeeIds":["emp_5512"],"effectiveFrom":"2025-12-17"}' | cut -c1-80
call -X POST $BASE/policies/$PLAIN/assignments -d '{"employeeIds":["emp_5514"],"effectiveFrom":"2025-01-01"}' | cut -c1-80

echo; echo "--- 1. accrue 2025-11 and 2025-12 - expect 20.0000 / 4.8387 / 20.0000 / 20.0000"
call -X POST $BASE/accrual-runs -d '{"period":"2025-11"}'
call -X POST $BASE/accrual-runs -d '{"period":"2025-12"}'
show

echo; echo "--- 2. retroactive request for emp_5513, 24 hours on 2025-12-10 to 12-11, approved - expect -4.0000"
REQ=$(curl -s "${H[@]}" -X POST $BASE/requests -d '{"employeeId":"emp_5513","type":"VACATION","startDate":"2025-12-10","endDate":"2025-12-11","hours":"24","reason":"entered late","idempotencyKey":"retro-5513"}' | jq -r '.id // .request.id')
call -X POST $BASE/requests/$REQ/approve -d '{}' | cut -c1-120
show

echo; echo "--- 3. year 2026 is not over - expect 422 YEAR_NOT_ENDED"
call -X POST $BASE/year-end-runs -d '{"year":2026}'

echo; echo "--- 4. two parallel runs of 2025 - created should add up to 1, the other reports alreadyExpired 1"
curl -s "${H[@]}" -X POST $BASE/year-end-runs -d '{"year":2025}' > /tmp/ye_a.json &
curl -s "${H[@]}" -X POST $BASE/year-end-runs -d '{"year":2025}' > /tmp/ye_b.json &
wait
cat /tmp/ye_a.json; echo; cat /tmp/ye_b.json; echo
echo "expect 8.0000 / 4.8387 / -4.0000 / 20.0000"
show

echo; echo "--- 5. rerun 2025 - expect created 0, alreadyExpired 1, skipped 2"
call -X POST $BASE/year-end-runs -d '{"year":2025}'

echo; echo "--- 6. emp_5511 expiry entry - expect -12.0000 dated 2025-12-31, period 2025"
curl -s "${H[@]}" "$BASE/employees/emp_5511/ledger?policyId=$CARRY" | jq -c '.[] | select(.kind == "EXPIRATION") | {kind, hours, occurredOn, period, detail}'

echo; echo "--- 7. audit - expect 3 YEAR_END_RUN rows (two parallel, one rerun), none for the 422"
AUD=$(docker compose exec -T postgres psql -U warp -d timeoff -Atc "SELECT tablename FROM pg_tables WHERE tablename LIKE 'audit%' LIMIT 1")
psql_run "SELECT action, entity_type, after FROM $AUD WHERE company_id = '$CO' AND action = 'YEAR_END_RUN' ORDER BY id;"

echo; echo "--- 8. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id WHERE b.employee_id IN ('emp_5511','emp_5512','emp_5513','emp_5514') GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"