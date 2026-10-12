import { payrollAccrualBody } from "@repo/shared/payroll";
import { computeWorkedAccrual } from "../src/lib/accrual";

const hw = (earnHours: string, perHoursWorked: string) => ({
  schemaVersion: 1 as const,
  accrual: { kind: "HOURS_WORKED" as const, earnHours, perHoursWorked },
});
const versions = [
  { versionNo: 1, effectiveFrom: "2026-01-01", config: hw("1", "30") },
  { versionNo: 2, effectiveFrom: "2026-03-25", config: hw("1", "20") },
];
const period = { periodStart: "2026-03-16", periodEnd: "2026-03-31" };
const timeBased = [
  { versionNo: 1, effectiveFrom: "2026-01-01", config: { schemaVersion: 1 as const, accrual: { kind: "TIME" as const, hoursPerMonth: "10" } } },
];

const show = (label: string, expected: string, r: ReturnType<typeof computeWorkedAccrual>) =>
  console.log(`${label}: ${r.hours.toFixed(4)} (expected ${expected}) ${r.hours.toFixed(4) === expected ? "ok" : "WRONG"} days=${r.detail.activeDays}`);

show("emp_4401 80h", "3.2500", computeWorkedAccrual({ ...period, hoursWorked: "80", assignmentFrom: "2026-01-01", assignmentTo: null, versions }));
show("emp_4402 40h joined 03-24", "1.9167", computeWorkedAccrual({ ...period, hoursWorked: "40", assignmentFrom: "2026-03-24", assignmentTo: null, versions }));
show("emp_4401 90h", "3.6563", computeWorkedAccrual({ ...period, hoursWorked: "90", assignmentFrom: "2026-01-01", assignmentTo: null, versions }));
show("emp_4404 30h leaver", "1.0000", computeWorkedAccrual({ ...period, hoursWorked: "30", assignmentFrom: "2026-01-01", assignmentTo: "2026-03-21", versions }));
show("no overlap", "0.0000", computeWorkedAccrual({ ...period, hoursWorked: "30", assignmentFrom: "2026-04-01", assignmentTo: null, versions }));
show("time based policy", "0.0000", computeWorkedAccrual({ ...period, hoursWorked: "30", assignmentFrom: "2026-01-01", assignmentTo: null, versions: timeBased }));
show("per hours worked 0", "0.0000", computeWorkedAccrual({ ...period, hoursWorked: "30", assignmentFrom: "2026-01-01", assignmentTo: null, versions: [{ versionNo: 1, effectiveFrom: "2026-01-01", config: hw("1", "0") }] }));
show("zero hours worked", "0.0000", computeWorkedAccrual({ ...period, hoursWorked: "0", assignmentFrom: "2026-01-01", assignmentTo: null, versions }));

// schema: valid, start after end, 3 months long, duplicate employee, negative hours, no entries
const ok = { ...period, entries: [{ employeeId: "emp_4401", hoursWorked: "80" }, { employeeId: "emp_4402", hoursWorked: "40.5" }] };
console.log(
  "schema (expect true false false false false false):",
  payrollAccrualBody.safeParse(ok).success,
  payrollAccrualBody.safeParse({ ...ok, periodStart: "2026-04-01" }).success,
  payrollAccrualBody.safeParse({ ...ok, periodStart: "2026-01-01" }).success,
  payrollAccrualBody.safeParse({ ...ok, entries: [ok.entries[0], ok.entries[0]] }).success,
  payrollAccrualBody.safeParse({ ...ok, entries: [{ employeeId: "e", hoursWorked: "-5" }] }).success,
  payrollAccrualBody.safeParse({ ...ok, entries: [] }).success,
);