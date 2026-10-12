"use client";

import type { AccrualKind } from "../lib/types";
import type { PolicyFormState, TierRow } from "../lib/policy-form";
import { Field } from "./ui";

const KINDS: { value: AccrualKind; label: string }[] = [
  { value: "TIME", label: "Hours per month" },
  { value: "HOURS_WORKED", label: "Per hours worked" },
  { value: "UNLIMITED", label: "Unlimited" },
];

type Props = {
  value: PolicyFormState;
  onChange: (next: PolicyFormState) => void;
  disabled?: boolean;
};

// the accrual part of a policy, shared by New Policy and Edit Policy
export function PolicyConfigFields({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<PolicyFormState>) => onChange({ ...value, ...patch });

  function setTier(index: number, patch: Partial<TierRow>) {
    set({ tiers: value.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  }

  return (
    <fieldset className="fieldset" disabled={disabled}>
      <legend className="field-label">How it accrues</legend>
      <div className="segmented" role="radiogroup" aria-label="Accrual kind">
        {KINDS.map((kind) => (
          <label key={kind.value} className={value.kind === kind.value ? "segment segment-on" : "segment"}>
            <input
              type="radio"
              name="accrual-kind"
              value={kind.value}
              checked={value.kind === kind.value}
              onChange={() => set({ kind: kind.value })}
            />
            {kind.label}
          </label>
        ))}
      </div>

      {value.kind === "TIME" ? (
        <>
          <Field label="Hours per month" hint="Posted at the end of each month, in hours">
            <input
              className="input"
              inputMode="decimal"
              value={value.hoursPerMonth}
              onChange={(e) => set({ hoursPerMonth: e.target.value })}
              placeholder="10"
            />
          </Field>
          <div className="stack-tight">
            <span className="field-label">Tiers by years of service</span>
            {value.tiers.map((tier, index) => (
              <div key={index} className="tier-row">
                <Field label="After years">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={tier.afterYears}
                    onChange={(e) => setTier(index, { afterYears: e.target.value })}
                    placeholder="2"
                  />
                </Field>
                <Field label="Hours per month">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={tier.hoursPerMonth}
                    onChange={(e) => setTier(index, { hoursPerMonth: e.target.value })}
                    placeholder="12"
                  />
                </Field>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => set({ tiers: value.tiers.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => set({ tiers: [...value.tiers, { afterYears: "", hoursPerMonth: "" }] })}
              >
                Add tier
              </button>
            </div>
          </div>
        </>
      ) : null}

      {value.kind === "HOURS_WORKED" ? (
        <div className="field-row">
          <Field label="Earn hours">
            <input
              className="input"
              inputMode="decimal"
              value={value.earnHours}
              onChange={(e) => set({ earnHours: e.target.value })}
              placeholder="1"
            />
          </Field>
          <Field label="Per hours worked">
            <input
              className="input"
              inputMode="decimal"
              value={value.perHoursWorked}
              onChange={(e) => set({ perHoursWorked: e.target.value })}
              placeholder="30"
            />
          </Field>
        </div>
      ) : null}

      {value.kind !== "UNLIMITED" ? (
        <>
          <Field label="Max negative hours" hint="How far below zero the balance may go. Empty means it may not go below zero.">
            <input
              className="input"
              inputMode="decimal"
              value={value.maxNegativeHours}
              onChange={(e) => set({ maxNegativeHours: e.target.value })}
              placeholder="0"
            />
          </Field>
          <div className="stack-tight">
            <label className="check">
              <input
                type="checkbox"
                checked={value.capCarryover}
                onChange={(e) => set({ capCarryover: e.target.checked })}
              />
              Cap what carries into the next year
            </label>
            {value.capCarryover ? (
              <Field label="Carryover up to (hours)" hint="Anything above this expires at year end. Without a cap everything carries over.">
                <input
                  className="input"
                  inputMode="decimal"
                  value={value.carryoverMax}
                  onChange={(e) => set({ carryoverMax: e.target.value })}
                  placeholder="8"
                />
              </Field>
            ) : null}
          </div>
        </>
      ) : (
        <p className="muted small">An unlimited policy has no balance, no negative floor and no carryover.</p>
      )}
    </fieldset>
  );
}
