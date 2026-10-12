import { policyConfigSchema } from "@repo/shared/policy";
import { hoursWord, trimHours } from "./format";
import type { AccrualKind, PolicyConfig } from "./types";

export type TierRow = { afterYears: string; hoursPerMonth: string };

// everything the form edits, kept as the strings people type
export type PolicyFormState = {
  kind: AccrualKind;
  hoursPerMonth: string;
  tiers: TierRow[];
  earnHours: string;
  perHoursWorked: string;
  maxNegativeHours: string;
  capCarryover: boolean;
  carryoverMax: string;
};

export const EMPTY_POLICY_FORM: PolicyFormState = {
  kind: "TIME",
  hoursPerMonth: "",
  tiers: [],
  earnHours: "",
  perHoursWorked: "",
  maxNegativeHours: "",
  capCarryover: false,
  carryoverMax: "",
};

// a stored config that no longer parses falls back to an empty form instead of crashing the screen
export function stateFromConfig(config: unknown): PolicyFormState {
  const parsed = policyConfigSchema.safeParse(config);
  if (!parsed.success) return EMPTY_POLICY_FORM;
  const { accrual, maxNegativeHours, carryover } = parsed.data;
  const base: PolicyFormState = {
    ...EMPTY_POLICY_FORM,
    kind: accrual.kind,
    maxNegativeHours: maxNegativeHours ?? "",
    capCarryover: carryover !== undefined,
    carryoverMax: carryover?.maxHours ?? "",
  };
  if (accrual.kind === "TIME") {
    return {
      ...base,
      hoursPerMonth: accrual.hoursPerMonth,
      tiers: (accrual.tiers ?? []).map((t) => ({ afterYears: String(t.afterYears), hoursPerMonth: t.hoursPerMonth })),
    };
  }
  if (accrual.kind === "HOURS_WORKED") {
    return { ...base, earnHours: accrual.earnHours, perHoursWorked: accrual.perHoursWorked };
  }
  return base;
}

// an empty box is left out so the schema says "required", a non number stays NaN so it says "expected number"
function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

// builds the raw config, the shared schema decides whether it is valid
export function buildConfig(form: PolicyFormState): unknown {
  let accrual: Record<string, unknown>;
  if (form.kind === "UNLIMITED") {
    accrual = { kind: "UNLIMITED" };
  } else if (form.kind === "TIME") {
    accrual = { kind: "TIME", hoursPerMonth: form.hoursPerMonth.trim() };
    if (form.tiers.length > 0) {
      accrual.tiers = form.tiers.map((t) => ({ afterYears: toNumber(t.afterYears), hoursPerMonth: t.hoursPerMonth.trim() }));
    }
  } else {
    accrual = { kind: "HOURS_WORKED", earnHours: form.earnHours.trim(), perHoursWorked: form.perHoursWorked.trim() };
  }

  const config: Record<string, unknown> = { schemaVersion: 1, accrual };
  if (form.kind !== "UNLIMITED") {
    if (form.maxNegativeHours.trim() !== "") config.maxNegativeHours = form.maxNegativeHours.trim();
    if (form.capCarryover) config.carryover = { maxHours: form.carryoverMax.trim() };
  }
  return config;
}

export type PolicyDescription = {
  schedule: string;
  rate: string;
  accrues: string;
  unit: string;
  tiers: string[];
  notes: string[];
};

// the card text for a version in force, accruals post in arrears so the timing is always end of period
export function describePolicy(config: PolicyConfig): PolicyDescription {
  const { accrual } = config;
  if (accrual.kind === "UNLIMITED") {
    return { schedule: "Unlimited", rate: "Unlimited", accrues: "Not applicable", unit: "Hour", tiers: [], notes: [] };
  }

  const notes: string[] = [];
  const floor = config.maxNegativeHours;
  notes.push(floor !== undefined && trimHours(floor) !== "0" ? `Can go ${hoursWord(floor)} below zero` : "Cannot go below zero");
  if (config.carryover) notes.push(`Carries over up to ${hoursWord(config.carryover.maxHours)} a year`);

  if (accrual.kind === "TIME") {
    return {
      schedule: "Monthly",
      rate: `${hoursWord(accrual.hoursPerMonth)} per month`,
      accrues: "End of period",
      unit: "Hour",
      tiers: (accrual.tiers ?? []).map(
        (t) => `After ${t.afterYears} ${t.afterYears === 1 ? "year" : "years"}: ${hoursWord(t.hoursPerMonth)} per month`,
      ),
      notes,
    };
  }

  return {
    schedule: "Per hours worked",
    rate: `${hoursWord(accrual.earnHours)} per ${trimHours(accrual.perHoursWorked)} worked`,
    accrues: "End of period",
    unit: "Hour",
    tiers: [],
    notes,
  };
}
