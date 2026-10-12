"use client";

import { setHolidaysBody } from "@repo/shared/schedule";
import { useState, type FormEvent } from "react";
import { api, query } from "../lib/api";
import { todayIso, weekdayShort } from "../lib/format";
import type { CalendarDetail, Holiday, HolidayCounts } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow } from "../lib/validation";
import { useToast } from "./toast";
import { AsyncView, Empty, ErrorNote, Tag } from "./ui";

// the api takes 1 to 100 holidays per save
const MAX_ROWS = 100;
const ALL_YEARS = "all";

type Row = { date: string; name: string };

const emptyRow = (): Row => ({ date: "", name: "" });

function HolidayRow({ calendarId, holiday, onRemoved }: { calendarId: string; holiday: Holiday; onRemoved: () => void }) {
  const action = useAction();
  const notify = useToast();

  async function remove() {
    const ok = await action.run(async () => {
      await api(`/holiday-calendars/${calendarId}/holidays/${holiday.date}`, { method: "DELETE" });
    });
    if (ok) {
      notify(`Removed ${holiday.name}`);
      onRemoved();
    }
  }

  return (
    <li className="holiday">
      <div className="holiday-line">
        <span className="holiday-date">
          {weekdayShort(holiday.date)} {holiday.date}
        </span>
        <span className="holiday-name">{holiday.name}</span>
        <button type="button" className="btn btn-sm" onClick={remove} disabled={action.pending}>
          {action.pending ? "Removing..." : "Remove"}
        </button>
      </div>
      <ErrorNote error={action.error} />
    </li>
  );
}

function HolidayEditor({ calendarId, onSaved }: { calendarId: string; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [counts, setCounts] = useState<HolidayCounts | null>(null);
  const action = useAction();

  const update = (index: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCounts(null);
    let result: HolidayCounts | undefined;
    const ok = await action.run(async () => {
      // a row left completely empty is skipped, a half filled one is the schema's problem
      const filled = rows.filter((r) => r.date.trim() !== "" || r.name.trim() !== "");
      const body = parseOrThrow(setHolidaysBody, { holidays: filled });
      result = await api<HolidayCounts>(`/holiday-calendars/${calendarId}/holidays`, { method: "PUT", body });
    });
    if (ok && result) {
      setCounts(result);
      setRows([emptyRow()]);
      onSaved();
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h3>Add or update holidays</h3>
      <p className="muted small">
        A date that already exists gets the new name. Up to {MAX_ROWS} per save, the same file again changes nothing.
      </p>
      <ul className="plain-list">
        {rows.map((row, index) => (
          <li key={index} className="holiday-edit">
            <input
              className="input"
              type="date"
              value={row.date}
              onChange={(e) => update(index, { date: e.target.value })}
              aria-label={`Holiday ${index + 1} date`}
            />
            <input
              className="input"
              value={row.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="Thanksgiving"
              aria-label={`Holiday ${index + 1} name`}
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setRows((all) => (all.length === 1 ? [emptyRow()] : all.filter((_, i) => i !== index)))}
            >
              Remove row
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setRows((all) => [...all, emptyRow()])}
          disabled={rows.length >= MAX_ROWS}
        >
          Add row
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={action.pending}>
          {action.pending ? "Saving..." : "Save holidays"}
        </button>
      </div>
      <ErrorNote error={action.error} />
      {counts ? (
        <div className="note note-ok" role="status">
          Added {counts.added}, updated {counts.updated}, unchanged {counts.unchanged}
        </div>
      ) : null}
    </form>
  );
}

export function CalendarDetailView({ calendarId, onChanged }: { calendarId: string; onChanged: () => void }) {
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const detail = useApi<CalendarDetail>(
    `/holiday-calendars/${calendarId}${query({ year: year === ALL_YEARS ? undefined : year })}`,
  );

  // the count on the list and the holidays of this year both change on a write
  function changed() {
    detail.refetch();
    onChanged();
  }

  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
  return (
    <section className="card stack">
      <AsyncView state={detail}>
        {({ calendar, holidays }) => (
          <>
            <div className="card-head">
              <div className="policy-title">
                <h2>{calendar.name}</h2>
                {calendar.isDefault ? <Tag tone="accent">Default</Tag> : null}
              </div>
              <select
                className="input select-compact"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                aria-label="Year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                <option value={ALL_YEARS}>All years</option>
              </select>
            </div>
            <p className="muted small">
              A holiday is skipped, not charged. One added after a request is approved never changes that request.
            </p>
            {holidays.length === 0 ? (
              <Empty>No holidays in {year === ALL_YEARS ? "this calendar" : year}.</Empty>
            ) : (
              <ul className="plain-list holiday-list">
                {holidays.map((h) => (
                  <HolidayRow key={h.date} calendarId={calendarId} holiday={h} onRemoved={changed} />
                ))}
              </ul>
            )}
            <HolidayEditor calendarId={calendarId} onSaved={changed} />
          </>
        )}
      </AsyncView>
    </section>
  );
}
