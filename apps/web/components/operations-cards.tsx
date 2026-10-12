"use client";

import { accrualRunBody } from "@repo/shared/ledger";
import { payrollAccrualBody } from "@repo/shared/payroll";
import { yearEndBody } from "@repo/shared/year-end";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { addDays, todayIso } from "../lib/format";
import { parsePayrollPaste } from "../lib/payroll-paste";
import { useAction } from "../lib/use-action";
import { parseOrThrow } from "../lib/validation";
import { ErrorNote, Field } from "./ui";

type Mismatch = { employeeId: string; policyId: string; accruedHoursWorked: string; receivedHoursWorked: string };

type Counts = Record<string, number>;

// alreadyAccrued reads "Already accrued"
function humanize(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Stats({ counts, label }: { counts: Counts; label: string }) {
  return (
    <div className="note note-ok stats" role="status">
      <strong>{label}</strong>
      <dl className="stat-list">
        {Object.entries(counts).map(([key, value]) => (
          <div key={key} className="stat">
            <dt>{humanize(key)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OperationCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// the first day of the month before today, the latest month an accrual run accepts
function lastFinishedMonth(): string {
  const date = new Date(`${todayIso().slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export function MonthlyAccrualCard() {
  const [period, setPeriod] = useState(lastFinishedMonth);
  const [result, setResult] = useState<{ label: string; counts: Counts } | null>(null);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    await action.run(async () => {
      const body = parseOrThrow(accrualRunBody, { period });
      const answer = await api<{ period: string } & Counts>("/accrual-runs", { method: "POST", body });
      const { period: ran, ...counts } = answer;
      setResult({ label: `Accrual for ${ran}`, counts });
    });
  }

  return (
    <OperationCard title="Monthly accrual">
      <p className="muted">
        Posts one month of time based accrual for everyone assigned. It is safe to run again, a month is never posted twice.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Month" hint="Only a finished month can run">
          <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Running..." : "Run accrual"}
          </button>
        </div>
      </form>
      {result ? <Stats label={result.label} counts={result.counts} /> : null}
    </OperationCard>
  );
}

type PayrollResult = { counts: Counts; mismatched: Mismatch[]; label: string };

export function PayrollAccrualCard() {
  const lastMonth = lastFinishedMonth();
  const [periodStart, setPeriodStart] = useState(`${lastMonth}-01`);
  const [periodEnd, setPeriodEnd] = useState(() => addDays(`${todayIso().slice(0, 7)}-01`, -1));
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<PayrollResult | null>(null);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    await action.run(async () => {
      const parsed = parsePayrollPaste(paste);
      if (parsed.problem) throw new ApiError(400, "VALIDATION_ERROR", parsed.problem);
      const body = parseOrThrow(payrollAccrualBody, { periodStart, periodEnd, entries: parsed.entries });
      const answer = await api<{ periodStart: string; periodEnd: string; mismatched: Mismatch[] } & Counts>(
        "/payroll-accruals",
        { method: "POST", body },
      );
      const { periodStart: from, periodEnd: to, mismatched, ...counts } = answer;
      setResult({ label: `Payroll accrual ${from} to ${to}`, counts, mismatched });
    });
  }

  return (
    <OperationCard title="Payroll accrual">
      <p className="muted">
        For policies that accrue per hours worked. Paste one <code>employeeId,hoursWorked</code> per line. Sending the same
        file again is safe, rows that differ from what was posted come back as mismatched.
      </p>
      <form className="stack" onSubmit={submit}>
        <div className="field-row">
          <Field label="Period start">
            <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label="Period end">
            <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Hours worked">
          <textarea
            className="input mono"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"emp_2201,160\nemp_2202,120"}
            spellCheck={false}
            rows={5}
          />
        </Field>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Running..." : "Run payroll accrual"}
          </button>
        </div>
      </form>
      {result ? (
        <>
          <Stats label={result.label} counts={{ ...result.counts, mismatched: result.mismatched.length }} />
          {result.mismatched.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Policy</th>
                    <th>Posted hours worked</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mismatched.map((m) => (
                    <tr key={`${m.employeeId}-${m.policyId}`}>
                      <td>{m.employeeId}</td>
                      <td className="mono">{m.policyId}</td>
                      <td>{m.accruedHoursWorked}</td>
                      <td>{m.receivedHoursWorked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </OperationCard>
  );
}

export function YearEndCard() {
  const [year, setYear] = useState(String(Number(todayIso().slice(0, 4)) - 1));
  const [result, setResult] = useState<{ label: string; counts: Counts } | null>(null);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    await action.run(async () => {
      const body = parseOrThrow(yearEndBody, { year: Number(year) });
      const answer = await api<{ year: number } & Counts>("/year-end-runs", { method: "POST", body });
      const { year: ran, ...counts } = answer;
      setResult({ label: `Year end ${ran}`, counts });
    });
  }

  return (
    <OperationCard title="Year end">
      <p className="muted">
        Expires hours above each policy's carryover cap. Only a finished year can run, and running it again changes nothing.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Year">
          <input
            className="input"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2026"
          />
        </Field>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Running..." : "Run year end"}
          </button>
        </div>
      </form>
      {result ? <Stats label={result.label} counts={result.counts} /> : null}
    </OperationCard>
  );
}
