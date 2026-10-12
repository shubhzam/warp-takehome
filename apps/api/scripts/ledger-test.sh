#!/usr/bin/env bash
# end to end check for the ledger feature - run from the repo root with the api up on :4000
# needs jq. uses a fresh company id every run so reruns never collide
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
H=(-H "x-company-id: $CO" -H "x-user-id: admin_1" -H "x-role: ADMIN" -H "content-type: application/json")
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }
call() { curl -s -w ' [%{http_code}]\n' "${H[@]}" "$@"; }
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_2201','emp_2202','emp_2203');"
echo "--- setup: two policies, v2 on plus, three employees"
STD=$(curl -s "${H[@]}" -X POST $BASE/policies -d '{"name":"PTO Standard","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}' | jq -r .policy.id)
PLUS=$(curl -s "${H[@]}" -X POST $BASE/policies -d '{"name":"PTO Plus","type":"SICK","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}' | jq -r .policy.id)
echo "std=$STD plus=$PLUS"
psql_run "INSERT INTO policy_versions (id, policy_id, version_no, effective_from, config, created_by, reason) VALUES (gen_random_uuid(), '$PLUS', 2, '2026-03-16', '{\"schemaVersion\":1,\"accrual\":{\"kind\":\"TIME\",\"hoursPerMonth\":\"12\"}}', 'admin_1', 'test backfill');"
call -X POST $BASE/policies/$STD/assignments -d '{"employeeIds":["emp_2201"],"effectiveFrom":"2026-01-01"}'
call -X POST $BASE/policies/$STD/assignments -d '{"employeeIds":["emp_2202"],"effectiveFrom":"2026-03-10"}'
call -X POST $BASE/policies/$PLUS/assignments -d '{"employeeIds":["emp_2203"],"effectiveFrom":"2026-01-01"}'

show() { for e in emp_2201 emp_2202 emp_2203; do echo -n "$e: "; curl -s "${H[@]}" $BASE/employees/$e/balances | jq -c '[.[] | {policy: .policyName, hours}]'; done; }

echo; echo "--- 1. run 2026-03 - expect created 3, balances 10.0000 / 7.0968 / 11.0323"
call -X POST $BASE/accrual-runs -d '{"period":"2026-03"}'
show

echo; echo "--- 2. rerun 2026-03 - expect created 0, alreadyAccrued 3"
call -X POST $BASE/accrual-runs -d '{"period":"2026-03"}'

echo; echo "--- 3. two parallel runs of 2026-04 - created should add up to 3, each balance gains one month only"
curl -s "${H[@]}" -X POST $BASE/accrual-runs -d '{"period":"2026-04"}' > /tmp/run_a.json &
curl -s "${H[@]}" -X POST $BASE/accrual-runs -d '{"period":"2026-04"}' > /tmp/run_b.json &
wait
cat /tmp/run_a.json; echo; cat /tmp/run_b.json; echo
echo "expect 20.0000 / 17.0968 / 23.0323"
show

echo; echo "--- 4. period that has not ended - expect 422 PERIOD_NOT_ENDED"
call -X POST $BASE/accrual-runs -d '{"period":"2026-10"}'

echo; echo "--- 5. adjustment: new (201), replay (200 same entry), same key other hours (409)"
ADJ='{"employeeId":"emp_2201","policyId":"'$STD'","kind":"ADJUSTMENT","hours":"5","reason":"manual correction","idempotencyKey":"adj-1"}'
call -X POST $BASE/adjustments -d "$ADJ"
call -X POST $BASE/adjustments -d "$ADJ"
call -X POST $BASE/adjustments -d "${ADJ/\"5\"/\"6\"}"
echo "expect emp_2201 at 25.0000"
show

echo; echo "--- ledger read, emp_2201 filtered to the standard policy"
curl -s "${H[@]}" "$BASE/employees/emp_2201/ledger?policyId=$STD" | jq -c '.[] | {kind, hours, occurredOn}'

echo; echo "--- 6. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"

echo; echo "--- 7. append only, both should error"
psql_run "UPDATE ledger_entries SET hours = 0;"
psql_run "DELETE FROM ledger_entries;"