"use client";

import { useState } from "react";
import { hoursLabel, isNegativeHours, trimHours } from "../lib/format";
import type { AccrualSegment, LedgerEntry, LedgerKind } from "../lib/types";
import { Tag } from "./ui";

const KIND_TONE: Record<LedgerKind, "ok" | "warn" | "danger" | "muted" | "accent"> = {
  ACCRUAL: "ok",
  ADJUSTMENT: "accent",
  TIME_OFF: "warn",
  TIME_OFF_REVERSAL: "muted",
  EXPIRATION: "danger",
};

const KIND_LABEL: Record<LedgerKind, string> = {
  ACCRUAL: "Accrual",
  ADJUSTMENT: "Adjustment",
  TIME_OFF: "Time off",
  TIME_OFF_REVERSAL: "Time off reversal",
  EXPIRATION: "Expiration",
};

type AccrualDetail = {
  daysInPeriod?: number;
  segments?: AccrualSegment[];
  // payroll accruals say what was worked instead of how long the period was
  source?: string;
  hoursWorked?: string;
  activeDays?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function segmentsOf(entry: LedgerEntry): AccrualSegment[] {
  if (entry.kind !== "ACCRUAL" || !isRecord(entry.detail)) return [];
  const { segments } = entry.detail as AccrualDetail;
  return Array.isArray(segments) ? segments : [];
}

// "9 days at 10, 22 days at 12", each part is the days a version or tier rate was in force
function segmentText(s: AccrualSegment): string {
  const days = `${s.days} ${s.days === 1 ? "day" : "days"}`;
  if (s.monthlyHours !== undefined) {
    const tenure = s.tenureYears !== undefined ? `, ${s.tenureYears} years of service` : "";
    return `${days} at ${hoursLabel(s.monthlyHours)} a month (version ${s.versionNo}${tenure})`;
  }
  if (s.earnHours !== undefined && s.perHoursWorked !== undefined) {
    return `${days} at ${trimHours(s.earnHours)}h per ${trimHours(s.perHoursWorked)}h worked (version ${s.versionNo})`;
  }
  return `${days} on version ${s.versionNo}`;
}

function headline(detail: AccrualDetail): string {
  if (detail.hoursWorked !== undefined) {
    const active = detail.activeDays !== undefined ? ` over ${detail.activeDays} active days` : "";
    return `Payroll accrual, ${trimHours(detail.hoursWorked)}h worked${active}`;
  }
  return detail.daysInPeriod ? `${detail.daysInPeriod} days in the period` : "Accrual segments";
}

function Detail({ entry }: { entry: LedgerEntry }) {
  const segments = segmentsOf(entry);
  if (segments.length > 0) {
    return (
      <div className="ledger-detail">
        <p className="small muted">{headline(entry.detail as AccrualDetail)}</p>
        <ul className="plain-list">
          {segments.map((s, i) => (
            <li key={i}>{segmentText(s)}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (entry.detail === null || entry.detail === undefined) {
    return <div className="ledger-detail muted small">No further detail on this entry.</div>;
  }
  return (
    <div className="ledger-detail">
      <pre className="json">{JSON.stringify(entry.detail, null, 2)}</pre>
    </div>
  );
}

function Row({ entry, policyName }: { entry: LedgerEntry; policyName: string }) {
  const [open, setOpen] = useState(false);
  const negative = isNegativeHours(entry.hours);
  const segments = segmentsOf(entry);
  return (
    <li className="ledger-row">
      <div className="ledger-line">
        <span className="ledger-date">{entry.occurredOn}</span>
        <Tag tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Tag>
        <span className="ledger-policy">{policyName}</span>
        <span className={negative ? "ledger-hours negative" : "ledger-hours"}>
          {negative ? "" : "+"}
          {hoursLabel(entry.hours)}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : segments.length > 0 ? "Segments" : "Details"}
        </button>
      </div>
      <div className="muted small">
        {entry.period ? `Period ${entry.period}. ` : ""}
        {entry.reason ? `${entry.reason}. ` : ""}By {entry.createdBy}
      </div>
      {open ? <Detail entry={entry} /> : null}
    </li>
  );
}

export function LedgerTable({ entries, policyNames }: { entries: LedgerEntry[]; policyNames: Record<string, string> }) {
  return (
    <ul className="plain-list ledger-list">
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} policyName={policyNames[entry.policyId] ?? entry.policyId} />
      ))}
    </ul>
  );
}
