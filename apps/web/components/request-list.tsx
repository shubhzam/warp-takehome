"use client";

import Link from "next/link";
import { api } from "../lib/api";
import { hoursLabel, TYPE_LABELS, todayIso, trimHours } from "../lib/format";
import type { RequestStatus, TimeOffRequest } from "../lib/types";
import { useAction } from "../lib/use-action";
import { ErrorNote, Tag } from "./ui";

export const STATUS_TONE: Record<RequestStatus, "warn" | "ok" | "danger" | "muted"> = {
  PENDING: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
  CANCELLED: "muted",
};

// a pending request can always be withdrawn, an approved one only before its first day
export function canCancel(request: TimeOffRequest, today: string): boolean {
  if (request.status === "PENDING") return true;
  return request.status === "APPROVED" && request.startDate > today;
}

// one line on how the server priced it, requests from before schedules existed have no computation
export function pricingNote(request: TimeOffRequest): string | null {
  const c = request.computation;
  if (!c) return null;
  const holidays = c.days.filter((d) => d.kind === "HOLIDAY").length;
  const skipped = holidays > 0 ? `, ${holidays} ${holidays === 1 ? "holiday" : "holidays"} skipped` : "";
  if (c.source === "GIVEN") {
    return `Asked for ${hoursLabel(request.hours)} of ${hoursLabel(c.scheduledHours)} scheduled${skipped}`;
  }
  return `All ${hoursLabel(c.scheduledHours)} scheduled${skipped}`;
}

type RowProps = { request: TimeOffRequest; showEmployee?: boolean; onCancelled: () => void };

// used on the employee page, the admin queue has its own rows with the decision actions
export function RequestRow({ request, showEmployee, onCancelled }: RowProps) {
  const action = useAction();
  const today = todayIso();

  async function cancel() {
    const ok = await action.run(async () => {
      await api(`/requests/${request.id}/cancel`, { method: "POST", body: {} });
    });
    if (ok) onCancelled();
  }

  const note = pricingNote(request);
  return (
    <li className="request">
      <div className="request-main">
        <div className="request-title">
          <strong>
            {request.startDate === request.endDate ? request.startDate : `${request.startDate} to ${request.endDate}`}
          </strong>
          <Tag>{TYPE_LABELS[request.type]}</Tag>
          <Tag tone={STATUS_TONE[request.status]}>{request.status.toLowerCase()}</Tag>
        </div>
        <div className="muted">
          {showEmployee ? (
            <>
              <Link href={`/employees?id=${encodeURIComponent(request.employeeId)}`}>{request.employeeId}</Link>
              {", "}
            </>
          ) : null}
          {trimHours(request.hours)}h{request.reason ? `, ${request.reason}` : ""}
        </div>
        {note ? <div className="muted small">{note}</div> : null}
        {request.decisionReason ? (
          <div className="small">
            {request.status === "REJECTED" ? "Rejected" : "Note"}: {request.decisionReason}
          </div>
        ) : null}
      </div>
      {canCancel(request, today) ? (
        <div>
          <button type="button" className="btn btn-sm" onClick={cancel} disabled={action.pending}>
            {action.pending ? "Cancelling..." : "Cancel request"}
          </button>
        </div>
      ) : null}
      <ErrorNote error={action.error} />
    </li>
  );
}
