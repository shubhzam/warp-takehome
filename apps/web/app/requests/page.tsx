"use client";

import { requestStatuses } from "@repo/shared/requests";
import { useState, type FormEvent } from "react";
import { AdminOnly } from "../../components/admin-only";
import { QueueRow } from "../../components/queue-row";
import { useToast } from "../../components/toast";
import { AsyncView, Empty, PageHeader } from "../../components/ui";
import { query } from "../../lib/api";
import type { RequestStatus, TimeOffRequest } from "../../lib/types";
import { useApi } from "../../lib/use-api";

const TAB_LABEL: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

function Queue() {
  const [status, setStatus] = useState<RequestStatus>("PENDING");
  const [employeeInput, setEmployeeInput] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const requests = useApi<TimeOffRequest[]>(`/requests${query({ status, employeeId: employeeId.trim() })}`);
  const notify = useToast();

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setEmployeeId(employeeInput);
  }

  // the list is refetched after every decision, a failed approval changes nothing but the message
  function decided(message: string) {
    notify(message);
    requests.refetch();
  }

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle="Pending requests hold no balance. The balance floor is checked when a request is approved."
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Request status">
          {requestStatuses.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={status === s ? "tab tab-on" : "tab"}
              onClick={() => setStatus(s)}
            >
              {TAB_LABEL[s]}
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={applyFilter}>
          <input
            className="input"
            value={employeeInput}
            onChange={(e) => setEmployeeInput(e.target.value)}
            placeholder="Filter by employee id"
            aria-label="Filter by employee id"
            spellCheck={false}
          />
          <button type="submit" className="btn">
            Filter
          </button>
        </form>
      </div>

      <AsyncView state={requests}>
        {(list) =>
          list.length === 0 ? (
            <Empty>No {TAB_LABEL[status].toLowerCase()} requests{employeeId.trim() ? ` for ${employeeId.trim()}` : ""}.</Empty>
          ) : (
            <ul className="plain-list request-list">
              {list.map((r) => (
                <QueueRow key={r.id} request={r} onDecided={decided} />
              ))}
            </ul>
          )
        }
      </AsyncView>
    </>
  );
}

export default function RequestsPage() {
  return (
    <AdminOnly>
      <Queue />
    </AdminOnly>
  );
}
