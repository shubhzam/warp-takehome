import { policyConfigSchema } from "@repo/shared/policy";
import { computeAccrual, tenureYears, type AccrualVersion } from "../src/lib/accrual";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n     expected ${e}\n     got      ${a}`);
  }
}

// builds a version through the real schema so the configs here are valid configs
function version(versionNo: number, effectiveFrom: string, accrual: unknown): AccrualVersion {
  return { versionNo, effectiveFrom, config: policyConfigSchema.parse({ schemaVersion: 1, accrual }) };
}

function rejects(name: string, config: unknown) {
  check(name, policyConfigSchema.safeParse(config).success, false);
}

const base = [version(1, "2025-01-01", { kind: "TIME", hoursPerMonth: "10" })];
const tiered = [
  version(1, "2025-01-01", {
    kind: "TIME",
    hoursPerMonth: "10",
    tiers: [
      { afterYears: 2, hoursPerMonth: "12" },
      { afterYears: 5, hoursPerMonth: "15" },
    ],
  }),
];

// regression, policies without tiers must give the numbers from the ledger feature
const full = computeAccrual({ period: "2026-03", assignmentFrom: "2026-01-01", assignmentTo: null, versions: base });
check("no tiers, full month", full.hours.toFixed(4), "10.0000");
check("no tiers, one segment without tenure", full.detail.segments, [{ versionNo: 1, days: 31, monthlyHours: "10" }]);

const joiner = computeAccrual({ period: "2026-03", assignmentFrom: "2026-03-10", assignmentTo: null, versions: base });
check("no tiers, joins on the 10th", joiner.hours.toFixed(4), "7.0968");

const twoVersions = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: null,
  versions: [...base, version(2, "2026-03-16", { kind: "TIME", hoursPerMonth: "12" })],
});
check("no tiers, rate change on the 16th", twoVersions.hours.toFixed(4), "11.0323");

// tenure, the company A numbers from the definition of done
const e5501 = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: null,
  versions: tiered,
  startDate: "2024-03-10",
});
check("emp_5501 crosses 2 years on march 10", e5501.hours.toFixed(4), "11.4194");
check("emp_5501 segments", e5501.detail.segments, [
  { versionNo: 1, days: 9, monthlyHours: "10", tenureYears: 1 },
  { versionNo: 1, days: 22, monthlyHours: "12", tenureYears: 2 },
]);

const e5502 = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: null,
  versions: tiered,
  startDate: "2021-01-15",
});
check("emp_5502 is past 5 years", e5502.hours.toFixed(4), "15.0000");

const e5503 = computeAccrual({ period: "2026-03", assignmentFrom: "2026-01-01", assignmentTo: null, versions: tiered });
check("emp_5503 no start date, tenure from the assignment", e5503.hours.toFixed(4), "10.0000");
check("emp_5503 segments", e5503.detail.segments, [{ versionNo: 1, days: 31, monthlyHours: "10", tenureYears: 0 }]);

const futureHire = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: null,
  versions: tiered,
  startDate: "2027-01-01",
});
check("start date after the period gives the base rate", futureHire.hours.toFixed(4), "10.0000");

// a version change and an anniversary in the same month, three segments
const split = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: null,
  versions: [
    ...tiered,
    version(2, "2026-03-20", { kind: "TIME", hoursPerMonth: "10", tiers: [{ afterYears: 2, hoursPerMonth: "14" }] }),
  ],
  startDate: "2024-03-10",
});
check("version change and anniversary in one month", split.hours.toFixed(4), "12.1935");
check("three segments", split.detail.segments.map((s) => [s.versionNo, s.days, s.monthlyHours]), [
  [1, 9, "10"],
  [1, 10, "12"],
  [2, 12, "14"],
]);

// assignment that ends mid month still splits correctly
const leaver = computeAccrual({
  period: "2026-03",
  assignmentFrom: "2026-01-01",
  assignmentTo: "2026-03-20",
  versions: tiered,
  startDate: "2024-03-10",
});
check("assignment ends on the 20th, 19 active days", leaver.hours.toFixed(4), "6.7742");

// anniversaries
check("anniversary day counts", tenureYears("2024-03-10", "2026-03-10"), 2);
check("day before the anniversary", tenureYears("2024-03-10", "2026-03-09"), 1);
check("before the start", tenureYears("2024-03-10", "2023-12-01"), 0);
check("feb 29 start, feb 28 of a common year", tenureYears("2024-02-29", "2026-02-28"), 1);
check("feb 29 start, mar 1 of a common year", tenureYears("2024-02-29", "2026-03-01"), 2);
check("feb 29 start, feb 29 of a leap year", tenureYears("2024-02-29", "2028-02-29"), 4);

// schema
const time = (extra: object) => ({ schemaVersion: 1, accrual: { kind: "TIME", hoursPerMonth: "10", ...extra } });
rejects("tiers must ascend", time({ tiers: [{ afterYears: 5, hoursPerMonth: "12" }, { afterYears: 2, hoursPerMonth: "15" }] }));
rejects("tiers cannot repeat a year", time({ tiers: [{ afterYears: 2, hoursPerMonth: "12" }, { afterYears: 2, hoursPerMonth: "15" }] }));
rejects("afterYears 0 is not a tier", time({ tiers: [{ afterYears: 0, hoursPerMonth: "12" }] }));
rejects("tiers on hours worked", {
  schemaVersion: 1,
  accrual: { kind: "HOURS_WORKED", earnHours: "1", perHoursWorked: "30", tiers: [{ afterYears: 2, hoursPerMonth: "12" }] },
});
rejects("carryover on unlimited", { schemaVersion: 1, accrual: { kind: "UNLIMITED" }, carryover: { maxHours: "8" } });
check("carryover with a cap of 0 is valid", policyConfigSchema.safeParse({ ...time({}), carryover: { maxHours: "0" } }).success, true);
check("carryover on time is valid", policyConfigSchema.safeParse({ ...time({}), carryover: { maxHours: "8" }, maxNegativeHours: "8" }).success, true);

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log("\nall checks passed");
