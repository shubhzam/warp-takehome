#!/usr/bin/env bash
# end to end check for requests and approvals - run from the repo root with the api up on :4000
# needs jq. uses a fresh company each run, dates are hard coded around 2026-10-12 (nov dates stay in the future until 2026-11-02)
BASE=${BASE:-http://localhost:4000}
CO=$(uuidgen | tr 'A-Z' 'a-z')
psql_run() { docker compose exec -T postgres psql -U warp -d timeoff -c "$1" 2>&1; }

# as ADMIN or as <employeeId> sets the headers for the next calls
as() {
  if [ "$1" = ADMIN ]; then
    H=(-H "x-company-id: $CO" -H "x-user-id: usr_2217" -H "x-role: ADMIN" -H "content-type: application/json")
  else
    H=(-H "x-company-id: $CO" -H "x-user-id: $1" -H "x-role: EMPLOYEE" -H "content-type: application/json")
  fi
}

# prints the status code plus the useful fields, keeps the full body in $LAST
call() {
  local out code body
  out=$(curl -s -w '\n%{http_code}' "${H[@]}" "$@")
  code=${out##*$'\n'}
  body=${out%$'\n'*}
  LAST=$body
  echo "$code $(jq -c 'if type == "array" then map({status, startDate}) elif .error then .error else {id, status, startDate, hours} end' <<<"$body" 2>/dev/null || echo "$body")"
}
raw() { curl -s "${H[@]}" "$@"; }

# req <employee> <start> <end> <hours> <key> [type]
req() { echo '{"employeeId":"'$1'","type":"'${6:-VACATION}'","startDate":"'$2'","endDate":"'$3'","hours":"'$4'","idempotencyKey":"'$5'"}'; }
bal() { as ADMIN; echo -n "$1 balance: "; raw $BASE/employees/$1/balances | jq -c '[.[] | {policy: .policyName, hours}]'; }
ledger() { as ADMIN; echo -n "$1 ledger: "; raw $BASE/employees/$1/ledger | jq -c '[.[] | {kind, hours}]'; }

echo "--- setup: 3 policies, 4 employees, opening balances of 24"
psql_run "DELETE FROM assignments WHERE employee_id IN ('emp_3301','emp_3302','emp_3303','emp_3304');"
as ADMIN
STD=$(raw -X POST $BASE/policies -d '{"name":"PTO Standard","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"}}}' | jq -r .policy.id)
FLEX=$(raw -X POST $BASE/policies -d '{"name":"PTO Flex","type":"VACATION","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"TIME","hoursPerMonth":"10"},"maxNegativeHours":"8"}}' | jq -r .policy.id)
UNL=$(raw -X POST $BASE/policies -d '{"name":"Sick Unlimited","type":"SICK","effectiveFrom":"2026-01-01","config":{"schemaVersion":1,"accrual":{"kind":"UNLIMITED"}}}' | jq -r .policy.id)
echo "std=$STD flex=$FLEX unl=$UNL"
raw -X POST $BASE/policies/$STD/assignments -d '{"employeeIds":["emp_3301","emp_3304"],"effectiveFrom":"2026-01-01"}' > /dev/null
raw -X POST $BASE/policies/$FLEX/assignments -d '{"employeeIds":["emp_3302"],"effectiveFrom":"2026-01-01"}' > /dev/null
raw -X POST $BASE/policies/$UNL/assignments -d '{"employeeIds":["emp_3303"],"effectiveFrom":"2026-01-01"}' > /dev/null
for pair in "emp_3301:$STD" "emp_3302:$FLEX" "emp_3304:$STD"; do
  e=${pair%%:*}; p=${pair##*:}
  raw -X POST $BASE/adjustments -d '{"employeeId":"'$e'","policyId":"'$p'","kind":"OPENING_BALANCE","hours":"24","reason":"opening balance","idempotencyKey":"open-'$e'"}' > /dev/null
done
bal emp_3301; bal emp_3302; bal emp_3304

echo; echo "--- 1. employee submits A, 16h on nov 2-3: expect 201 PENDING, balance still 24.0000"
as emp_3301
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-02 2026-11-03 16 a1)"
A=$(jq -r .id <<<"$LAST")
bal emp_3301

echo; echo "--- 2. replay: expect 200 same id, then same key with other hours 409 IDEMPOTENCY_KEY_REUSED"
as emp_3301
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-02 2026-11-03 16 a1)"
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-02 2026-11-03 8 a1)"

echo; echo "--- 3. overlap on nov 3: expect 409 REQUEST_OVERLAP"
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-03 2026-11-04 8 a2)"

echo; echo "--- 4. submit B, 16h on nov 9-10: expect 201"
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-09 2026-11-10 16 b1)"
B=$(jq -r .id <<<"$LAST")

echo; echo "--- 5. admin approves A: expect 200 APPROVED, balance 8.0000, again 200, one TIME_OFF of -16.0000"
as ADMIN
call -X POST $BASE/requests/$A/approve -d '{}'
bal emp_3301
call -X POST $BASE/requests/$A/approve -d '{}'
ledger emp_3301

echo; echo "--- 6. admin approves B: expect 422 INSUFFICIENT_BALANCE (needs 16, available 8), B stays PENDING"
call -X POST $BASE/requests/$B/approve -d '{}'
echo -n "B status: "; raw $BASE/requests/$B | jq -r .status

echo; echo "--- 7. reject B: expect 200 REJECTED, then approve B gives 409 INVALID_TRANSITION"
call -X POST $BASE/requests/$B/reject -d '{"reason":"not enough balance"}'
call -X POST $BASE/requests/$B/approve -d '{}'

echo; echo "--- 8. employee cancels approved A: expect 200 CANCELLED, balance 24.0000, again 200, ledger has a TIME_OFF_REVERSAL"
as emp_3301
call -X POST $BASE/requests/$A/cancel -d '{"reason":"plans changed"}'
bal emp_3301
call -X POST $BASE/requests/$A/cancel -d '{}'
ledger emp_3301

echo; echo "--- 9. the freed days can be booked again: expect 201"
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-02 2026-11-03 16 a3)"

echo; echo "--- 10. role checks: 403 for someone else, 403 for employee approving, 404 for someone else's request, own list has 3"
as emp_3301
call -X POST $BASE/requests -d "$(req emp_3302 2026-11-23 2026-11-23 8 x1)"
call -X POST $BASE/requests/$B/approve -d '{}'
as emp_3302
call $BASE/requests/$A
as emp_3301
echo -n "emp_3301 sees: "; raw $BASE/requests | jq length

echo; echo "--- 11. validation: expect 422 HOURS_TOO_LARGE, 422 NOT_ASSIGNED"
as ADMIN
call -X POST $BASE/requests -d "$(req emp_3301 2026-11-23 2026-11-23 25 v1)"
call -X POST $BASE/requests -d "$(req emp_3303 2026-11-23 2026-11-23 8 v2)"

echo; echo "--- 12. negative balance on a policy with maxNegativeHours 8: C and D approved, balance -8.0000, then G of 1h refused"
as emp_3302
call -X POST $BASE/requests -d "$(req emp_3302 2026-11-02 2026-11-03 16 c1)"
C=$(jq -r .id <<<"$LAST")
call -X POST $BASE/requests -d "$(req emp_3302 2026-11-09 2026-11-10 16 d1)"
D=$(jq -r .id <<<"$LAST")
call -X POST $BASE/requests -d "$(req emp_3302 2026-11-16 2026-11-16 1 g1)"
G=$(jq -r .id <<<"$LAST")
as ADMIN
call -X POST $BASE/requests/$C/approve -d '{}'
bal emp_3302
call -X POST $BASE/requests/$D/approve -d '{}'
bal emp_3302
call -X POST $BASE/requests/$G/approve -d '{}'

echo; echo "--- 13. two approvals at the same moment against 24h: expect one 200 and one 422, balance 8.0000"
as emp_3304
call -X POST $BASE/requests -d "$(req emp_3304 2026-12-01 2026-12-02 16 e1)"
E=$(jq -r .id <<<"$LAST")
call -X POST $BASE/requests -d "$(req emp_3304 2026-12-08 2026-12-09 16 f1)"
F=$(jq -r .id <<<"$LAST")
as ADMIN
curl -s -o /tmp/par_e.json -w '%{http_code}' "${H[@]}" -X POST $BASE/requests/$E/approve -d '{}' > /tmp/par_e.code &
curl -s -o /tmp/par_f.json -w '%{http_code}' "${H[@]}" -X POST $BASE/requests/$F/approve -d '{}' > /tmp/par_f.code &
wait
echo "E: $(cat /tmp/par_e.code) $(jq -r '.error.code // .status' /tmp/par_e.json)"
echo "F: $(cat /tmp/par_f.code) $(jq -r '.error.code // .status' /tmp/par_f.json)"
bal emp_3304

echo; echo "--- 14. unlimited policy: approve and cancel change status only, no balance row"
as emp_3303
call -X POST $BASE/requests -d "$(req emp_3303 2026-11-02 2026-11-03 8 u1 SICK)"
U1=$(jq -r .id <<<"$LAST")
as ADMIN
call -X POST $BASE/requests/$U1/approve -d '{}'
bal emp_3303
call -X POST $BASE/requests/$U1/cancel -d '{}'

echo; echo "--- 15. retroactive request already started: approve is 200, cancel is 422 TOO_LATE_TO_CANCEL"
call -X POST $BASE/requests -d "$(req emp_3303 2026-10-05 2026-10-05 8 u2 SICK)"
U2=$(jq -r .id <<<"$LAST")
call -X POST $BASE/requests/$U2/approve -d '{}'
call -X POST $BASE/requests/$U2/cancel -d '{}'

echo; echo "--- 16. final balances: expect 24.0000 / -8.0000 / none / 8.0000"
bal emp_3301; bal emp_3302; bal emp_3303; bal emp_3304

echo; echo "--- 17. reconcile: balances vs sum of ledger, expect 0 rows"
psql_run "SELECT b.employee_id, b.hours, COALESCE(SUM(l.hours),0) AS ledger_sum FROM balances b LEFT JOIN ledger_entries l ON l.employee_id=b.employee_id AND l.policy_id=b.policy_id GROUP BY b.employee_id, b.policy_id, b.hours HAVING b.hours <> COALESCE(SUM(l.hours),0);"

echo; echo "--- 18. ledger by kind for this company: expect OPENING_BALANCE 3 / 72, TIME_OFF 4 / -64, TIME_OFF_REVERSAL 1 / 16"
psql_run "SELECT kind, count(*), sum(hours) FROM ledger_entries WHERE company_id = '$CO' GROUP BY kind ORDER BY kind;"

echo; echo "--- 19. audit rows for requests: expect CREATED 10, APPROVED 6, REJECTED 1, CANCELLED 2"
psql_run "SELECT action, count(*) FROM audit_events WHERE company_id = '$CO' AND entity_type = 'request' GROUP BY action ORDER BY action;"