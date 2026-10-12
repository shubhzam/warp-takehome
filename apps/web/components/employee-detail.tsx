"use client";

import { useState } from "react";
import { query } from "../lib/api";
import { hoursLabel, isNegativeHours, TYPE_LABELS, todayIso } from "../lib/format";
import type { Assignment, Balance, CalendarSummary, LedgerEntry, PolicySummary } from "../lib/types";
import { useApi } from "../lib/use-api";
import { AdjustmentModal } from "./adjustment-modal";
import { statusOf } from "./assignments-drawer";
import { LedgerTable } from "./ledger-table";
import { ScheduleCard } from "./schedule-card";
import { StartDateCard } from "./start-date-card";
import { useToast } from "./toast";
import { AsyncView, Empty, Tag } from "./ui";

function BalancesCard({ balances, assignments, names }: {
  balances: Balance[];
  assignments: Assignment[];
  names: Record<string, string>;
}) {
  // an unlimited policy has no balance row, so it shows up from the assignments
  const held = new Set(balances.map((b) => b.policyId));
  const withoutBalance = assignments.filter((a) => !held.has(a.policyId) && statusOf(a, todayIso()).label === "Active");
  if (balances.length === 0 && withoutBalance.length === 0) {
    return <Empty>No balances yet. Nothing has been accrued for this employee.</Empty>;
  }
  return (
    <ul className="plain-list balance-list">
      {balances.map((b) => (
        <li key={b.policyId} className="balance-item">
          <span>
            <strong>{b.policyName}</strong> <Tag>{TYPE_LABELS[b.type]}</Tag>
          </span>
          <span className={isNegativeHours(b.hours) ? "balance-hours negative" : "balance-hours"}>{hoursLabel(b.hours)}</span>
        </li>
      ))}
      {withoutBalance.map((a) => (
        <li key={a.id} className="balance-item">
          <span>
            <strong>{names[a.policyId] ?? a.policyId}</strong> <Tag>{TYPE_LABELS[a.type]}</Tag>
          </span>
          <span className="muted">No balance row</span>
        </li>
      ))}
    </ul>
  );
}

function AssignmentsCard({ assignments, names }: { assignments: Assignment[]; names: Record<string, string> }) {
  if (assignments.length === 0) return <Empty>This employee has no assignments.</Empty>;
  const today = todayIso();
  return (
    <ul className="plain-list">
      {assignments.map((a) => {
        const status = statusOf(a, today);
        return (
          <li key={a.id} className="balance-item">
            <span>
              <strong>{names[a.policyId] ?? a.policyId}</strong> <Tag>{TYPE_LABELS[a.type]}</Tag>{" "}
              <Tag tone={status.tone}>{status.label}</Tag>
            </span>
            <span className="muted small">
              from {a.effectiveFrom}, {a.effectiveTo ? `ends before ${a.effectiveTo}` : "no end date"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function EmployeeDetail({ employeeId }: { employeeId: string }) {
  const id = encodeURIComponent(employeeId);
  const balances = useApi<Balance[]>(`/employees/${id}/balances`);
  const assignments = useApi<Assignment[]>(`/employees/${id}/assignments`);
  const policies = useApi<PolicySummary[]>("/policies");
  const calendars = useApi<CalendarSummary[]>("/holiday-calendars");
  const [ledgerPolicy, setLedgerPolicy] = useState("");
  const ledger = useApi<LedgerEntry[]>(`/employees/${id}/ledger${query({ policyId: ledgerPolicy })}`);
  const [adjusting, setAdjusting] = useState(false);
  const notify = useToast();

  const names: Record<string, string> = {};
  for (const p of policies.data ?? []) names[p.id] = p.name;
  for (const b of balances.data ?? []) names[b.policyId] = b.policyName;

  // the policies an adjustment can target: anything assigned or already holding a balance
  const policyIds = [...new Set([...(balances.data ?? []).map((b) => b.policyId), ...(assignments.data ?? []).map((a) => a.policyId)])];
  const adjustable = policyIds.map((policyId) => ({ id: policyId, name: names[policyId] ?? policyId }));

  function adjusted() {
    setAdjusting(false);
    notify("Adjustment posted");
    balances.refetch();
    ledger.refetch();
  }

  return (
    <>
      <div className="grid-2">
        <section className="card stack">
          <div className="card-head">
            <h2>Balances</h2>
            <button type="button" className="btn btn-sm" onClick={() => setAdjusting(true)} disabled={adjustable.length === 0}>
              Add adjustment
            </button>
          </div>
          <AsyncView state={balances}>
            {(rows) => <BalancesCard balances={rows} assignments={assignments.data ?? []} names={names} />}
          </AsyncView>
        </section>

        <section className="card stack">
          <h2>Assignments</h2>
          <AsyncView state={assignments}>{(rows) => <AssignmentsCard assignments={rows} names={names} />}</AsyncView>
        </section>
      </div>

      <div className="grid-2">
        <StartDateCard employeeId={employeeId} />
        <ScheduleCard employeeId={employeeId} calendars={calendars.data ?? []} />
      </div>

      <section className="card stack">
        <div className="card-head">
          <h2>Ledger</h2>
          <select
            className="input select-compact"
            value={ledgerPolicy}
            onChange={(e) => setLedgerPolicy(e.target.value)}
            aria-label="Filter the ledger by policy"
          >
            <option value="">All policies</option>
            {adjustable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <p className="muted small">Newest first. Accruals post in arrears and never rewrite, a correction is a new entry.</p>
        <AsyncView state={ledger}>
          {(entries) =>
            entries.length === 0 ? <Empty>No ledger entries.</Empty> : <LedgerTable entries={entries} policyNames={names} />
          }
        </AsyncView>
      </section>

      {adjusting ? (
        <AdjustmentModal employeeId={employeeId} policies={adjustable} onClose={() => setAdjusting(false)} onSaved={adjusted} />
      ) : null}
    </>
  );
}
