"use client";

import { useState } from "react";
import { AdminOnly } from "../../components/admin-only";
import { AssignmentsDrawer } from "../../components/assignments-drawer";
import { EditPolicyModal, NewPolicyModal } from "../../components/policy-modals";
import { PolicyCard } from "../../components/policy-card";
import { useToast } from "../../components/toast";
import { AsyncView, Empty, PageHeader } from "../../components/ui";
import type { PolicySummary } from "../../lib/types";
import { useApi } from "../../lib/use-api";

type Modal = { kind: "new" } | { kind: "edit"; policyId: string } | { kind: "assign"; policyId: string } | null;

function PoliciesView() {
  const policies = useApi<PolicySummary[]>("/policies");
  const [modal, setModal] = useState<Modal>(null);
  const notify = useToast();

  const assigning = modal?.kind === "assign" ? policies.data?.find((p) => p.id === modal.policyId) : undefined;

  // every write is followed by a refetch, so the cards show what the api now holds
  function saved(message: string) {
    setModal(null);
    notify(message);
    policies.refetch();
  }

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="Each card shows the version in force today. Changing a policy adds a version that only affects the future."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: "new" })}>
            New Policy
          </button>
        }
      />
      <AsyncView state={policies}>
        {(list) =>
          list.length === 0 ? (
            <Empty>No policies yet. Create the first one with New Policy.</Empty>
          ) : (
            <div className="card-grid">
              {list.map((policy) => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  onEdit={() => setModal({ kind: "edit", policyId: policy.id })}
                  onAssign={() => setModal({ kind: "assign", policyId: policy.id })}
                />
              ))}
            </div>
          )
        }
      </AsyncView>

      {modal?.kind === "new" ? <NewPolicyModal onClose={() => setModal(null)} onSaved={saved} /> : null}
      {modal?.kind === "edit" ? (
        <EditPolicyModal policyId={modal.policyId} onClose={() => setModal(null)} onSaved={saved} />
      ) : null}
      {assigning ? <AssignmentsDrawer policy={assigning} onClose={() => setModal(null)} onChanged={notify} /> : null}
    </>
  );
}

export default function PoliciesPage() {
  return (
    <AdminOnly>
      <PoliciesView />
    </AdminOnly>
  );
}
