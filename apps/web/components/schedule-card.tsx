"use client";

import { setWorkScheduleBody } from "@repo/shared/schedule";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { hoursLabel, todayIso, trimHours, weekdayName, workDaysLabel } from "../lib/format";
import type { CalendarSummary, WorkSchedule, WorkScheduleView } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow } from "../lib/validation";
import { useToast } from "./toast";
import { AsyncView, ErrorNote, Field, Tag } from "./ui";

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7];

function calendarName(id: string | null, calendars: CalendarSummary[]): string {
  if (id === null) return "company default calendar";
  return calendars.find((c) => c.id === id)?.name ?? id;
}

// a schedule row in words, the standard fallback reads the way the doc names it
function describe(schedule: WorkSchedule, calendars: CalendarSummary[]): string {
  const base = `${hoursLabel(schedule.hoursPerDay)}, ${workDaysLabel(schedule.workDays)}`;
  if (schedule.source === "STANDARD") return `Standard: ${base}`;
  return `${base}, ${calendarName(schedule.calendarId, calendars)}`;
}

function ScheduleForm({
  inForce,
  calendars,
  employeeId,
  onSaved,
  onCancel,
}: {
  inForce: WorkSchedule;
  calendars: CalendarSummary[];
  employeeId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const [hoursPerDay, setHoursPerDay] = useState(trimHours(inForce.hoursPerDay));
  const [days, setDays] = useState<number[]>(inForce.workDays);
  const [calendarId, setCalendarId] = useState(inForce.calendarId ?? "");
  const action = useAction();

  function toggle(day: number) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      const body = parseOrThrow(setWorkScheduleBody, {
        effectiveFrom,
        hoursPerDay: hoursPerDay.trim(),
        workDays: [...days].sort((a, b) => a - b),
        calendarId: calendarId === "" ? null : calendarId,
      });
      await api(`/employees/${encodeURIComponent(employeeId)}/work-schedule`, { method: "PUT", body });
    });
    if (ok) onSaved();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field-row">
        <Field label="Effective from" hint="Requests are priced with the row in force on each day">
          <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label="Hours per day" hint="Up to 24, for example 7.5">
          <input
            className="input"
            inputMode="decimal"
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend className="field-label">Work days</legend>
        <div className="weekdays">
          {ISO_DAYS.map((day) => (
            <label key={day} className={days.includes(day) ? "segment segment-on" : "segment"}>
              <input type="checkbox" checked={days.includes(day)} onChange={() => toggle(day)} />
              {weekdayName(day)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Holiday calendar">
        <select className="input" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
          <option value="">Company default</option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNote error={action.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={action.pending}>
          {action.pending ? "Saving..." : "Save schedule"}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={action.pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ScheduleCard({ employeeId, calendars }: { employeeId: string; calendars: CalendarSummary[] }) {
  const state = useApi<WorkScheduleView>(`/employees/${encodeURIComponent(employeeId)}/work-schedule`);
  const [editing, setEditing] = useState(false);
  const notify = useToast();

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Work schedule</h2>
        {!editing ? (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={state.data === null}>
            Set a schedule
          </button>
        ) : null}
      </div>
      <AsyncView state={state}>
        {({ inForce, history }) => (
          <>
            <div>
              <p>
                <strong>{describe(inForce, calendars)}</strong>
              </p>
              <p className="muted small">
                {inForce.source === "STANDARD"
                  ? "No schedule row exists for this employee, so the standard week applies with the company default calendar."
                  : `In force since ${inForce.effectiveFrom}.`}
              </p>
            </div>
            {editing ? (
              <ScheduleForm
                inForce={inForce}
                calendars={calendars}
                employeeId={employeeId}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  notify("Work schedule saved");
                  state.refetch();
                }}
              />
            ) : null}
            <div className="stack-tight">
              <h3>History</h3>
              {history.length === 0 ? (
                <p className="muted small">No changes yet.</p>
              ) : (
                <ul className="plain-list">
                  {history.map((row) => (
                    <li key={row.id ?? row.effectiveFrom} className="small">
                      <strong>From {row.effectiveFrom}</strong> {describe(row, calendars)}
                      {row.id !== null && row.id === inForce.id ? <> <Tag tone="ok">in force</Tag></> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </AsyncView>
    </section>
  );
}
