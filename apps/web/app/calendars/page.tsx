"use client";

import { createCalendarBody } from "@repo/shared/schedule";
import { useState, type FormEvent } from "react";
import { AdminOnly } from "../../components/admin-only";
import { CalendarDetailView } from "../../components/calendar-detail";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { AsyncView, Empty, ErrorNote, Field, PageHeader, Tag } from "../../components/ui";
import { api } from "../../lib/api";
import type { Calendar, CalendarSummary } from "../../lib/types";
import { useAction } from "../../lib/use-action";
import { useApi } from "../../lib/use-api";
import { parseOrThrow } from "../../lib/validation";

function NewCalendarModal({ onClose, onCreated }: { onClose: () => void; onCreated: (calendar: Calendar) => void }) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    let created: Calendar | undefined;
    const ok = await action.run(async () => {
      const body = parseOrThrow(createCalendarBody, { name, isDefault });
      created = await api<Calendar>("/holiday-calendars", { method: "POST", body });
    });
    if (ok && created) onCreated(created);
  }

  return (
    <Modal title="New calendar" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="US" />
        </Field>
        <div className="stack-tight">
          <label className="check">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Make it the company default
          </label>
          <p className="hint">
            The default applies to employees whose schedule names no calendar. A company has one default, and it cannot be
            moved after creation.
          </p>
        </div>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Creating..." : "Create calendar"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Calendars() {
  const calendars = useApi<CalendarSummary[]>("/holiday-calendars");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const notify = useToast();

  function created(calendar: Calendar) {
    setCreating(false);
    setSelected(calendar.id);
    notify(`Calendar ${calendar.name} created`);
    calendars.refetch();
  }

  return (
    <>
      <PageHeader
        title="Holiday calendars"
        subtitle="Employees follow the calendar named in their work schedule, or the company default."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            New calendar
          </button>
        }
      />
      <div className="grid-split">
        <div className="stack">
          <AsyncView state={calendars}>
            {(list) =>
              list.length === 0 ? (
                <Empty>No calendars yet. Without one, requests are priced with no holidays.</Empty>
              ) : (
                <ul className="plain-list calendar-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={selected === c.id ? "calendar-item calendar-item-on" : "calendar-item"}
                        onClick={() => setSelected(c.id)}
                      >
                        <span className="strong">{c.name}</span>
                        <span className="calendar-meta">
                          {c.isDefault ? <Tag tone="accent">Default</Tag> : null}
                          <span className="muted small">
                            {c.holidayCount} {c.holidayCount === 1 ? "holiday" : "holidays"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </AsyncView>
        </div>
        {selected ? (
          <CalendarDetailView key={selected} calendarId={selected} onChanged={calendars.refetch} />
        ) : (
          <Empty>Open a calendar to see and edit its holidays.</Empty>
        )}
      </div>
      {creating ? <NewCalendarModal onClose={() => setCreating(false)} onCreated={created} /> : null}
    </>
  );
}

export default function CalendarsPage() {
  return (
    <AdminOnly>
      <Calendars />
    </AdminOnly>
  );
}
