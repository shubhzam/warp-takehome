"use client";

import { setStartDateBody } from "@repo/shared/tenure";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { StartDate } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow } from "../lib/validation";
import { useToast } from "./toast";
import { AsyncView, ErrorNote, Field } from "./ui";

function StartDateForm({ current, employeeId, onSaved }: { current: string | null; employeeId: string; onSaved: () => void }) {
  const [startDate, setStartDate] = useState(current ?? "");
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      const body = parseOrThrow(setStartDateBody, { startDate });
      await api(`/employees/${encodeURIComponent(employeeId)}/start-date`, { method: "PUT", body });
    });
    if (ok) onSaved();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Start date" hint="Only accruals not yet posted use a new date. Posted entries never change.">
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>
      <ErrorNote error={action.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={action.pending}>
          {action.pending ? "Saving..." : "Save start date"}
        </button>
      </div>
    </form>
  );
}

// the start date drives tenure tiers, it lives on the Employee Service side of the house so it is only a date here
export function StartDateCard({ employeeId }: { employeeId: string }) {
  const state = useApi<StartDate>(`/employees/${encodeURIComponent(employeeId)}/start-date`);
  const [editing, setEditing] = useState(false);
  const notify = useToast();

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Start date</h2>
        {!editing ? (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={state.data === null}>
            Change
          </button>
        ) : null}
      </div>
      <AsyncView state={state}>
        {(data) =>
          editing ? (
            <StartDateForm
              current={data.startDate}
              employeeId={employeeId}
              onSaved={() => {
                setEditing(false);
                notify("Start date saved");
                state.refetch();
              }}
            />
          ) : (
            <p>{data.startDate ?? <span className="muted">No start date recorded, tenure tiers will not apply.</span>}</p>
          )
        }
      </AsyncView>
    </section>
  );
}
