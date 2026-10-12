"use client";

import { listAuditQuery } from "@repo/shared/audit";
import { useState, type FormEvent } from "react";
import { AdminOnly } from "../../components/admin-only";
import { AuditList, type AuditFilters } from "../../components/audit-list";
import { ErrorNote, Field, PageHeader } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { parseOrThrow } from "../../lib/validation";

// suggestions only, the api accepts any value and these are the ones it writes today
const ENTITY_TYPES = [
  "policy",
  "assignment",
  "company",
  "ledger_entry",
  "request",
  "employee_start_date",
  "holiday_calendar",
  "work_schedule",
];
const ACTIONS = [
  "POLICY_CREATED",
  "POLICY_VERSION_CREATED",
  "ASSIGNMENT_CREATED",
  "ASSIGNMENT_ENDED",
  "ACCRUAL_RUN",
  "ADJUSTMENT_CREATED",
  "REQUEST_CREATED",
  "REQUEST_APPROVED",
  "REQUEST_REJECTED",
  "REQUEST_CANCELLED",
  "PAYROLL_ACCRUAL_RUN",
  "EMPLOYEE_START_DATE_SET",
  "YEAR_END_RUN",
  "HOLIDAY_CALENDAR_CREATED",
  "HOLIDAY_SET",
  "HOLIDAY_REMOVED",
  "WORK_SCHEDULE_SET",
];

const NO_FILTERS: AuditFilters = { entityType: "", action: "", entityId: "" };

function Audit() {
  const [draft, setDraft] = useState<AuditFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_FILTERS);
  // bumped by Refresh so the list starts again from the newest event
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  function apply(event: FormEvent) {
    event.preventDefault();
    const clean = {
      entityType: draft.entityType.trim(),
      action: draft.action.trim(),
      entityId: draft.entityId.trim(),
    };
    try {
      // the same schema the api uses, so a bad entity id is explained here and no call is made
      parseOrThrow(listAuditQuery, {
        ...(clean.entityType ? { entityType: clean.entityType } : {}),
        ...(clean.action ? { action: clean.action } : {}),
        ...(clean.entityId ? { entityId: clean.entityId } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
      return;
    }
    setError(null);
    setApplied(clean);
  }

  function clear() {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
    setError(null);
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change to policies, assignments, requests, schedules and ledgers, newest first."
        actions={
          <button type="button" className="btn" onClick={() => setRefresh((n) => n + 1)}>
            Refresh
          </button>
        }
      />
      <form className="card stack" onSubmit={apply}>
        <div className="field-row">
          <Field label="Entity type">
            <input
              className="input"
              list="audit-entity-types"
              value={draft.entityType}
              onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Action">
            <input
              className="input"
              list="audit-actions"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              placeholder="Any"
            />
          </Field>
          <Field label="Entity id" hint="A guid, optional">
            <input
              className="input mono"
              value={draft.entityId}
              onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
              placeholder="Any"
              spellCheck={false}
            />
          </Field>
        </div>
        <datalist id="audit-entity-types">
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <datalist id="audit-actions">
          {ACTIONS.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <ErrorNote error={error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
          <button type="button" className="btn" onClick={clear}>
            Clear
          </button>
        </div>
      </form>
      <AuditList
        key={`${applied.entityType}|${applied.action}|${applied.entityId}|${refresh}`}
        filters={applied}
      />
    </>
  );
}

export default function AuditPage() {
  return (
    <AdminOnly>
      <Audit />
    </AdminOnly>
  );
}
