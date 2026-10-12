"use client";

import { assignBody, endAssignmentBody } from "@repo/shared/policy";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { todayIso } from "../lib/format";
import type { Assignment, PolicySummary } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow } from "../lib/validation";
import { Modal } from "./modal";
import { AsyncView, Empty, ErrorNote, Field, Tag } from "./ui";

// ids can be separated by commas, spaces or new lines
function splitIds(text: string): string[] {
  return text.split(/[\s,]+/).filter((id) => id.length > 0);
}

function statusOf(a: Assignment, today: string): { label: string; tone: "ok" | "warn" | "muted" } {
  if (a.effectiveTo !== null && a.effectiveTo <= today) return { label: "Ended", tone: "muted" };
  if (a.effectiveFrom > today) return { label: "Starts later", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

function AssignForm({ policyId, onAssigned }: { policyId: string; onAssigned: (count: number) => void }) {
  const [ids, setIds] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    let count = 0;
    const ok = await action.run(async () => {
      const body = parseOrThrow(assignBody, { employeeIds: splitIds(ids), effectiveFrom });
      await api(`/policies/${policyId}/assignments`, { method: "POST", body });
      count = body.employeeIds.length;
    });
    if (ok) {
      setIds("");
      onAssigned(count);
    }
  }

  return (
    <form className="stack card" onSubmit={submit}>
      <h3>Assign employees</h3>
      <Field label="Employee ids" hint="Separate with commas, spaces or new lines, up to 500">
        <textarea
          className="input mono"
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="emp_2201, emp_2202"
          spellCheck={false}
        />
      </Field>
      <Field label="Effective from">
        <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>
      <ErrorNote error={action.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={action.pending}>
          {action.pending ? "Assigning..." : "Assign"}
        </button>
      </div>
    </form>
  );
}

function AssignmentRow({ assignment, onChanged }: { assignment: Assignment; onChanged: (message: string) => void }) {
  const today = todayIso();
  const status = statusOf(assignment, today);
  const [ending, setEnding] = useState(false);
  const [effectiveTo, setEffectiveTo] = useState(today);
  const action = useAction();

  async function end() {
    const ok = await action.run(async () => {
      const body = parseOrThrow(endAssignmentBody, { effectiveTo });
      await api(`/assignments/${assignment.id}`, { method: "PATCH", body });
    });
    if (ok) {
      setEnding(false);
      onChanged(`Assignment of ${assignment.employeeId} ends before ${effectiveTo}`);
    }
  }

  return (
    <li className="assignment">
      <div className="assignment-main">
        <Link className="strong" href={`/employees?id=${encodeURIComponent(assignment.employeeId)}`}>
          {assignment.employeeId}
        </Link>
        <Tag tone={status.tone}>{status.label}</Tag>
        <span className="muted small">
          from {assignment.effectiveFrom},{" "}
          {assignment.effectiveTo ? `ends before ${assignment.effectiveTo} (exclusive)` : "no end date"}
        </span>
      </div>
      {status.label !== "Ended" ? (
        ending ? (
          <div className="stack-tight">
            <Field label="End date" hint="Exclusive, the assignment covers the days before this date">
              <input className="input" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </Field>
            <div className="actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={end} disabled={action.pending}>
                {action.pending ? "Saving..." : "Save end date"}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEnding(false)} disabled={action.pending}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-sm" onClick={() => setEnding(true)}>
              {assignment.effectiveTo ? "Change end" : "End"}
            </button>
          </div>
        )
      ) : null}
      <ErrorNote error={action.error} />
    </li>
  );
}

type Props = { policy: Pick<PolicySummary, "id" | "name">; onClose: () => void; onChanged: (message: string) => void };

export function AssignmentsDrawer({ policy, onClose, onChanged }: Props) {
  const list = useApi<{ assignments: Assignment[] }>(`/policies/${policy.id}/assignments`);

  // a write is always followed by a refetch of the list, then the page hears about it for its toast
  function changed(message: string) {
    list.refetch();
    onChanged(message);
  }

  return (
    <Modal title="Manage Assignments" variant="drawer" onClose={onClose}>
      <p className="muted">
        <strong>{policy.name}</strong>. An employee can hold one policy of each type at a time, the API refuses overlaps.
      </p>
      <AssignForm policyId={policy.id} onAssigned={(count) => changed(`Assigned ${count} ${count === 1 ? "employee" : "employees"}`)} />
      <h3>Assignments</h3>
      <AsyncView state={list}>
        {({ assignments }) =>
          assignments.length === 0 ? (
            <Empty>Nobody is assigned to this policy yet.</Empty>
          ) : (
            <ul className="plain-list assignment-list">
              {assignments.map((a) => (
                <AssignmentRow key={a.id} assignment={a} onChanged={changed} />
              ))}
            </ul>
          )
        }
      </AsyncView>
    </Modal>
  );
}
