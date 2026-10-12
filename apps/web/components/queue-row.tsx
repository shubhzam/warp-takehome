"use client";

import { decisionBody, rejectBody } from "@repo/shared/requests";
import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { formatDateTime, TYPE_LABELS, todayIso, trimHours } from "../lib/format";
import type { TimeOffRequest } from "../lib/types";
import { useAction } from "../lib/use-action";
import { parseOrThrow } from "../lib/validation";
import { canCancel, pricingNote, STATUS_TONE } from "./request-list";
import { ErrorNote, Field, Tag } from "./ui";

type Decision = "approve" | "reject" | "cancel";

const DONE_MESSAGE: Record<Decision, string> = {
  approve: "Request approved",
  reject: "Request rejected",
  cancel: "Request cancelled",
};

// one request in the admin queue, a failed decision stays on its own row with the api's words
export function QueueRow({ request, onDecided }: { request: TimeOffRequest; onDecided: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const action = useAction();
  const today = todayIso();
  const pending = request.status === "PENDING";

  async function decide(decision: Decision) {
    const ok = await action.run(async () => {
      // reject needs a reason, approve and cancel take an optional one
      const body =
        decision === "reject"
          ? parseOrThrow(rejectBody, { reason })
          : parseOrThrow(decisionBody, reason.trim() ? { reason } : {});
      await api(`/requests/${request.id}/${decision}`, { method: "POST", body });
    });
    if (ok) onDecided(DONE_MESSAGE[decision]);
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
        <div>
          <Link className="strong" href={`/employees?id=${encodeURIComponent(request.employeeId)}`}>
            {request.employeeId}
          </Link>
          <span className="muted">
            {" "}
            asked for {trimHours(request.hours)}h{request.reason ? `: ${request.reason}` : ""}
          </span>
        </div>
        {note ? <div className="muted small">{note}</div> : null}
        <div className="muted small">Submitted {formatDateTime(request.createdAt)}</div>
        {request.decidedBy ? (
          <div className="small">
            Decided by {request.decidedBy}
            {request.decisionReason ? `: ${request.decisionReason}` : ""}
          </div>
        ) : null}
      </div>

      {pending ? (
        <>
          <Field label="Reason" hint="Required to reject, optional to approve">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => decide("approve")} disabled={action.pending}>
              Approve
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => decide("reject")} disabled={action.pending}>
              Reject
            </button>
          </div>
        </>
      ) : null}

      {canCancel(request, today) && !pending ? (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => decide("cancel")} disabled={action.pending}>
            Cancel request
          </button>
        </div>
      ) : null}

      <ErrorNote error={action.error} />
    </li>
  );
}
