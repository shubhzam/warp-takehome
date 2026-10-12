"use client";

import Link from "next/link";
import { useState } from "react";
import { BalanceBars, SummaryBar } from "../../components/balance-bars";
import { RequestModal } from "../../components/request-modal";
import { RequestRow } from "../../components/request-list";
import { useToast } from "../../components/toast";
import { AsyncView, Empty, PageHeader } from "../../components/ui";
import { query } from "../../lib/api";
import { addDays, todayIso } from "../../lib/format";
import { useSession } from "../../lib/session";
import { buildStandings, dayLengthOf } from "../../lib/standing";
import type { Balance, LedgerEntry, MyAssignment, Preview, TimeOffRequest } from "../../lib/types";
import { useApi } from "../../lib/use-api";

// how far ahead the page looks to learn what a work day costs this employee
const DAY_LENGTH_WINDOW_DAYS = 14;

function MyTimeOff({ employeeId }: { employeeId: string }) {
  const assignments = useApi<{ assignments: MyAssignment[] }>("/me/assignments");
  const balances = useApi<Balance[]>("/me/balances");
  const ledger = useApi<LedgerEntry[]>("/me/ledger");
  const requests = useApi<TimeOffRequest[]>("/requests");
  const today = todayIso();
  const probe = useApi<Preview>(
    `/requests/preview${query({ employeeId, startDate: today, endDate: addDays(today, DAY_LENGTH_WINDOW_DAYS - 1) })}`,
  );
  const [open, setOpen] = useState(false);
  const notify = useToast();

  // a request changes the balances only once approved, but one refetch keeps every block in step
  function refetchAll() {
    balances.refetch();
    ledger.refetch();
    requests.refetch();
  }

  function cancelled() {
    notify("Request cancelled");
    refetchAll();
  }

  const dayLength = dayLengthOf(probe.data);
  const list = assignments.data?.assignments ?? [];
  const standings = buildStandings(list, balances.data ?? [], ledger.data ?? [], today.slice(0, 4));
  const ready = assignments.data !== null && balances.data !== null && ledger.data !== null;

  return (
    <>
      <PageHeader
        title="My time off"
        subtitle="Hours are the unit. Days are a hint at your day length."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={!ready || list.length === 0}>
            Request time off
          </button>
        }
      />

      <AsyncView state={assignments}>
        {({ assignments: assigned }) =>
          assigned.length === 0 ? (
            <Empty>Nothing is assigned to you yet, so there is no time off to request. Ask an admin to assign a policy.</Empty>
          ) : ready ? (
            <>
              <SummaryBar standings={standings} dayLength={dayLength} />
              <BalanceBars standings={standings} dayLength={dayLength} />
            </>
          ) : (
            <p className="muted">Loading balances...</p>
          )
        }
      </AsyncView>

      <section className="stack">
        <h2>My requests</h2>
        <AsyncView state={requests}>
          {(all) =>
            all.length === 0 ? (
              <Empty>You have not asked for any time off yet.</Empty>
            ) : (
              <ul className="plain-list request-list">
                {all.map((r) => (
                  <RequestRow key={r.id} request={r} onCancelled={cancelled} />
                ))}
              </ul>
            )
          }
        </AsyncView>
      </section>

      {open ? (
        <RequestModal
          employeeId={employeeId}
          standings={standings}
          dayLength={dayLength}
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            setOpen(false);
            notify("Request submitted, it is pending approval");
            refetchAll();
          }}
        />
      ) : null}
    </>
  );
}

export default function TimeOffPage() {
  const { session } = useSession();
  if (session?.role !== "EMPLOYEE") {
    return (
      <section className="guard">
        <h1>This page is for employees</h1>
        <p className="muted">
          An admin has no balances or requests of their own. Switch to an employee session to see My time off, or use the
          admin pages.
        </p>
        <Link className="btn btn-primary" href="/policies">
          Go to policies
        </Link>
      </section>
    );
  }
  return <MyTimeOff employeeId={session.userId} />;
}
