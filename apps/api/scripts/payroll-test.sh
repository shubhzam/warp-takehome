#!/usr/bin/env bash
# end to end check for payroll accrual - run from the repo root with the api up on :4000
# needs jq. uses a fresh company each run, dates are hard coded around 2026-10-12
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
H=(-H "x-company-id: $CO" -H "x-user-id: usr_2217" -H "x-role: ADMIN" -H "content-type: application/json")
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }

# prints the status code and the compact body
call() {
  local out code body
  out=$(curl -s -w '\n%{http_code}' "${H[@]}" "$@")
  code=${out##*$'\n'}
  body=${out%$'\n'*}
  echo "$code $(jq -c . <<<"$body" 2>/dev/null || echo "$body")"
}
raw() { curl -s "${H[@]}" "$@"; }

# payload <start> <end> <employee:hours>...
payload() {
  local s=$1 e=$2 entries=""
  shift 2
  for pair in "$@"; do
    entries="$entries,{\"employeeId\":\"${pair%%:*}\",\"hoursWorked\":\"${pair##*:}\"}"
  done
  echo "{\"periodStart\":\"$s\",\"periodEnd\":\"$e\",\"entries\":[${entries#,}]}"
}
bal() { echo -n "$1 balance: "; raw $BASE/employees/$1/balances | jq -c '[.[] | {policy: .policyName, hours}]'; }
allbal() { bal emp_4401; bal emp_4402; bal emp_4403; bal emp_4404; }

echo "--- setup: Sick Earned (1 per 30, then 1 per 20 from 03-25), PTO Standard, four employees"
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_4401','emp_4402','emp_4403','emp_4404');"
SICK=$(raw -X POST $BASE/policies -d '{"name":"Sick Earned","type":"SICK","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"HOURS_WORKED","earnHours":"1","perHoursWorked":"30"}}}' | jq -r .policy.id)
STD=$(raw -X POST $BASE/policies -d '{"name":"PTO Standard","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}' | jq -r .policy.id)
echo "sick=$SICK std=$STD"
# versions must start today or later through the api, so the back dated one goes in with sql
psql_run "INSERT INTO policy_versions (id, policy_id, version_no, effective_from, config, created_by, reason) VALUES (gen_random_uuid(), '$SICK', 2, '2026-03-25', '{\"schemaVersion\":1,\"accrual\":{\"kind\":\"HOURS_WORKED\",\"earnHours\":\"1\",\"perHoursWorked\":\"20\"}}', 'admin_1', 'test backfill');"
raw -X POST $BASE/policies/$SICK/assignments -d '{"employeeIds":["emp_4401"],"effectiveFrom":"2026-01-01"}' > /dev/null
raw -X POST $BASE/policies/$SICK/assignments -d '{"employeeIds":["emp_4402"],"effectiveFrom":"2026-03-24"}' > /dev/null
raw -X POST $BASE/policies/$STD/assignments -d '{"employeeIds":["emp_4403"],"effectiveFrom":"2026-01-01"}' > /dev/null
# the leaver: assignment ended 03-21, back dated so it goes in with sql too
psql_run "INSERT INTO assignments (id, company_id, employee_id, policy_id, type, effective_from, effective_to) VALUES (gen_random_uuid(), '$CO', 'emp_4404', '$SICK', 'SICK', '2026-01-01', '2026-03-21');"

echo; echo "--- 1. send 03-16 to 03-31: expect created 3, skipped 1, balances 3.2500 / 1.9167 / none / 1.0000"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-03-16 2026-03-31 emp_4401:80 emp_4402:40 emp_4403:20 emp_4404:30)"
allbal
echo -n "emp_4401 entry: "; raw $BASE/employees/emp_4401/ledger | jq -c '.[0] | {kind, hours, period, detail}'

echo; echo "--- 2. send the same file again: expect created 0, alreadyAccrued 3, skipped 1"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-03-16 2026-03-31 emp_4401:80 emp_4402:40 emp_4403:20 emp_4404:30)"

echo; echo "--- 3. corrected hours for emp_4401: expect created 0, alreadyAccrued 1, mismatched lists emp_4401 80 vs 90, balance still 3.2500"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-03-16 2026-03-31 emp_4401:90 emp_4402:40)"
bal emp_4401

echo; echo "--- 4. two sends at the same moment, 04-01 to 04-15: created adds up to 2, balances 7.2500 / 3.9167 / none / 1.0000"
BODY=$(payload 2026-04-01 2026-04-15 emp_4401:80 emp_4402:40 emp_4403:20 emp_4404:30)
curl -s "${H[@]}" -X POST $BASE/payroll-accruals -d "$BODY" > /tmp/pay_a.json &
curl -s "${H[@]}" -X POST $BASE/payroll-accruals -d "$BODY" > /tmp/pay_b.json &
wait
jq -c . /tmp/pay_a.json; jq -c . /tmp/pay_b.json
allbal

echo; echo "--- 5. pay period not over: expect 422 PERIOD_NOT_ENDED"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-10-01 2026-10-31 emp_4401:80)"

echo; echo "--- 5b. validation: expect 400 for start after end, 400 for a 3 month period"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-03-31 2026-03-16 emp_4401:80)"
call -X POST $BASE/payroll-accruals -d "$(payload 2026-01-01 2026-03-31 emp_4401:80)"

echo; echo "--- 6. monthly run for 2026-03: expect created 1 (only emp_4403), skipped 3, hours worked balances unchanged"
call -X POST $BASE/accrual-runs -d '{"period":"2026-03"}'
echo "expect 7.2500 / 3.9167 / 10.0000 / 1.0000"
allbal

echo; echo "--- 7. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"

echo; echo "--- 8. ledger for this company: expect ACCRUAL 6 / 22.1667"
psql_run "SELECT kind, count(*), sum(hours) FROM ledger_entries WHERE company_id = '$CO' GROUP BY kind ORDER BY kind;"

echo; echo "--- 9. audit rows: expect ACCRUAL_RUN 1, PAYROLL_ACCRUAL_RUN 5 (the 422 and the 400s write none)"
psql_run "SELECT action, count(*) FROM audit_events WHERE company_id = '$CO' AND action IN ('ACCRUAL_RUN','PAYROLL_ACCRUAL_RUN') GROUP BY action ORDER BY action;"