"use client";

import { adjustmentBody } from "@repo/shared/ledger";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/use-action";
import { parseOrThrow } from "../lib/validation";
import { Modal } from "./modal";
import { ErrorNote, Field } from "./ui";

type Props = {
  employeeId: string;
  // the policies this employee is assigned to or has a balance in
  policies: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
};

export function AdjustmentModal({ employeeId, policies, onClose, onSaved }: Props) {
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  // made when the form opens, so pressing the button twice posts one entry
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      const body = parseOrThrow(adjustmentBody, {
        employeeId,
        policyId,
        kind: "ADJUSTMENT",
        hours: hours.trim(),
        reason,
        idempotencyKey,
      });
      await api("/adjustments", { method: "POST", body });
    });
    if (ok) onSaved();
  }

  return (
    <Modal title="Add adjustment" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          An adjustment is a signed entry in {employeeId}'s ledger. Use a minus sign to take hours away.
        </p>
        <Field label="Policy">
          <select className="input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hours" hint="For example 8 to add a day, -4 to remove half a day">
          <input className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="8" />
        </Field>
        <Field label="Reason" hint="Required, it is kept on the entry and in the audit log">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending || policies.length === 0}>
            {action.pending ? "Saving..." : "Post adjustment"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
