"use client";

import { createRequestBody } from "@repo/shared/requests";
import { previewQuery } from "@repo/shared/schedule";
import { useState, type FormEvent } from "react";
import { api, query } from "../lib/api";
import { addDays, hoursFromParts, hoursLabel, isZeroHours, TYPE_LABELS, todayIso, weekdayShort } from "../lib/format";
import type { Standing } from "../lib/standing";
import type { Preview, PricedDay, TimeOffType } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow, prettifyIssues } from "../lib/validation";
import { Modal } from "./modal";
import { SummaryBar } from "./balance-bars";
import { ErrorNote, Field } from "./ui";

const MAX_MINUTES = 59;

// minutes above 59 are refused in the form, the total is whole hours plus whole minutes
function partsProblem(hours: number, minutes: number): string | null {
  if (!Number.isInteger(hours) || hours < 0) return "Hours must be a whole number, zero or more";
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) return `Minutes must be between 0 and ${MAX_MINUTES}`;
  return null;
}

function dayLabel(day: PricedDay): string {
  if (day.kind === "HOLIDAY") return `Holiday${day.holidayName ? `: ${day.holidayName}` : ""}`;
  if (day.kind === "NON_WORKDAY") return "Not a work day";
  return "Work day";
}

// the server's own pricing of the range, nothing is computed in the browser
function PreviewBox({ preview, loading }: { preview: Preview | null; loading: boolean }) {
  if (!preview) return <p className="muted">{loading ? "Pricing the range..." : "Pick a range to see what it costs."}</p>;
  const workDays = preview.days.filter((d) => d.kind === "WORKDAY").length;
  return (
    <div className={loading ? "preview preview-loading" : "preview"}>
      <p>
        <strong>{hoursLabel(preview.hours)}</strong> over {workDays} work {workDays === 1 ? "day" : "days"}
      </p>
      {isZeroHours(preview.hours) ? (
        <p className="muted small">No working days in this range, so there is nothing to request.</p>
      ) : null}
      <ul className="plain-list day-list">
        {preview.days.map((day) => (
          <li key={day.date} className={day.kind === "WORKDAY" ? "day" : "day day-off"}>
            <span>
              {weekdayShort(day.date)} {day.date}
            </span>
            <span className="muted">{dayLabel(day)}</span>
            <span className="day-hours">{day.kind === "WORKDAY" ? hoursLabel(day.hours) : "-"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  employeeId: string;
  standings: Standing[];
  dayLength: number | null;
  onClose: () => void;
  onSubmitted: () => void;
};

export function RequestModal({ employeeId, standings, dayLength, onClose, onSubmitted }: Props) {
  const tomorrow = addDays(todayIso(), 1);
  const types = standings.map((s) => s.assignment.type);
  const [reason, setReason] = useState("");
  const [type, setType] = useState<TimeOffType>(types[0] ?? "VACATION");
  const [startDate, setStartDate] = useState(tomorrow);
  const [endDate, setEndDate] = useState(tomorrow);
  const [fewer, setFewer] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // made once when the modal opens, so a double click or a retry replays instead of duplicating
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const action = useAction();

  const range = previewQuery.safeParse({ employeeId, startDate, endDate });
  const previewPath = range.success ? `/requests/preview${query({ employeeId, startDate, endDate })}` : null;
  const preview = useApi<Preview>(previewPath);
  const rangeMessage = !range.success && startDate && endDate ? prettifyIssues(range.error.issues) : null;

  const hoursNumber = Number(hours || "0");
  const minutesNumber = Number(minutes || "0");
  const partsError = fewer ? partsProblem(hoursNumber, minutesNumber) : null;
  const noWorkDays = preview.data !== null && isZeroHours(preview.data.hours);
  const nothingAsked = fewer && hoursNumber === 0 && minutesNumber === 0;
  const canSubmit = !action.pending && range.success && !noWorkDays && partsError === null && !nothingAsked;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") {
      setFormError("Reason is required");
      return;
    }
    setFormError(null);
    const ok = await action.run(async () => {
      const body = parseOrThrow(createRequestBody, {
        employeeId,
        type,
        startDate,
        endDate,
        reason: reason.trim(),
        idempotencyKey,
        ...(fewer ? { hours: hoursFromParts(hoursNumber, minutesNumber) } : {}),
      });
      await api("/requests", { method: "POST", body });
    });
    if (ok) onSubmitted();
  }

  // the api's words for too many hours sit next to the hours fields, any other failure sits above the buttons
  const hoursError = fewer && action.error?.code === "HOURS_TOO_LARGE" ? action.error : null;
  const otherError = hoursError ? null : action.error;

  return (
    <Modal title="Request time off" onClose={onClose}>
      <SummaryBar standings={standings} dayLength={dayLength} />
      <form className="stack" onSubmit={submit}>
        <Field label="Reason (required)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Family trip" />
        </Field>
        <Field label="Category (required)">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as TimeOffType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="fieldset">
          <legend className="field-label">Days</legend>
          <div className="field-row">
            <Field label="From">
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          {rangeMessage ? <div className="note note-danger pre">{rangeMessage}</div> : null}
          {previewPath ? <ErrorNote error={preview.error} /> : null}
          {previewPath ? <PreviewBox preview={preview.data} loading={preview.loading} /> : null}
        </fieldset>

        <div className="stack-tight">
          <label className="check">
            <input type="checkbox" checked={fewer} onChange={(e) => setFewer(e.target.checked)} />
            Request fewer hours
          </label>
          {fewer ? (
            <>
              <div className="field-row">
                <Field label="Hours">
                  <input className="input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Minutes">
                  <input className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="0" />
                </Field>
              </div>
              <p className="hint">
                A total for the whole range, not per day.
                {preview.data ? ` The range is worth ${hoursLabel(preview.data.hours)}, you cannot ask for more.` : ""}
              </p>
              {partsError ? <p className="note note-danger">{partsError}</p> : null}
              <ErrorNote error={hoursError} />
            </>
          ) : null}
        </div>

        {formError ? <p className="note note-danger">{formError}</p> : null}
        <ErrorNote error={otherError} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {action.pending ? "Submitting..." : "Submit request"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
