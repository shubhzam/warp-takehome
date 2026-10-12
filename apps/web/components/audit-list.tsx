"use client";

import { useState } from "react";
import { api, query } from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";
import { diffJson, showValue } from "../lib/json-diff";
import type { AuditEvent, AuditPage } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { AsyncView, Empty, ErrorNote, Tag } from "./ui";

export type AuditFilters = { entityType: string; action: string; entityId: string };

const PAGE_SIZE = 50;

function pathFor(filters: AuditFilters, beforeId: string | null): string {
  return `/audit-events${query({ ...filters, limit: PAGE_SIZE, beforeId })}`;
}

function Changes({ event }: { event: AuditEvent }) {
  const changes = diffJson(event.before, event.after);
  if (changes.length === 0) return <p className="muted small">No field changed in the recorded before and after.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.path}>
              <td className="mono">{c.path}</td>
              <td className="mono diff-before">{showValue(c.before)}</td>
              <td className="mono diff-after">{showValue(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="audit-row">
      <div className="audit-line">
        <Tag tone="accent">{event.action}</Tag>
        <span className="muted small">{formatDateTime(event.createdAt)}</span>
      </div>
      <div className="small">
        <strong>{event.entityType}</strong> <span className="mono" title={event.entityId}>{shortId(event.entityId)}</span>
        <span className="muted">
          {" "}
          by {event.actorId} ({event.actorRole.toLowerCase()})
        </span>
      </div>
      {event.reason ? <div className="small">Reason: {event.reason}</div> : null}
      <div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide changes" : "Show changes"}
        </button>
      </div>
      {open ? <Changes event={event} /> : null}
    </li>
  );
}

// remounted by the page when the filters or the refresh counter change, so paging state never outlives its query
export function AuditList({ filters }: { filters: AuditFilters }) {
  const first = useApi<AuditPage>(pathFor(filters, null));
  const [later, setLater] = useState<{ events: AuditEvent[]; next: string | null } | null>(null);
  const action = useAction();

  async function loadMore(beforeId: string) {
    await action.run(async () => {
      const page = await api<AuditPage>(pathFor(filters, beforeId));
      setLater((current) => ({ events: [...(current?.events ?? []), ...page.events], next: page.nextBeforeId }));
    });
  }

  return (
    <AsyncView state={first}>
      {(page) => {
        const events = [...page.events, ...(later?.events ?? [])];
        const next = later ? later.next : page.nextBeforeId;
        if (events.length === 0) return <Empty>No audit events match these filters.</Empty>;
        return (
          <>
            <ul className="plain-list audit-list">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
            <ErrorNote error={action.error} />
            <div className="actions">
              {next ? (
                <button type="button" className="btn" onClick={() => loadMore(next)} disabled={action.pending}>
                  {action.pending ? "Loading..." : "Load more"}
                </button>
              ) : (
                <span className="muted small">That is every event for these filters.</span>
              )}
              <span className="muted small">{events.length} shown</span>
            </div>
          </>
        );
      }}
    </AsyncView>
  );
}
