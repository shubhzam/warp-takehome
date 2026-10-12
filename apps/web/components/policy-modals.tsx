"use client";

import { createPolicyBody, createVersionBody, timeOffTypes } from "@repo/shared/policy";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { TYPE_LABELS, todayIso } from "../lib/format";
import { buildConfig, EMPTY_POLICY_FORM, stateFromConfig, type PolicyFormState } from "../lib/policy-form";
import type { PolicyDetail, PolicyVersion, TimeOffType } from "../lib/types";
import { useAction } from "../lib/use-action";
import { useApi } from "../lib/use-api";
import { parseOrThrow } from "../lib/validation";
import { Modal } from "./modal";
import { PolicyConfigFields } from "./policy-config-fields";
import { AsyncView, ErrorNote, Field } from "./ui";

type DoneProps = { onClose: () => void; onSaved: (message: string) => void };

export function NewPolicyModal({ onClose, onSaved }: DoneProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TimeOffType>("VACATION");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const [reason, setReason] = useState("");
  const [config, setConfig] = useState<PolicyFormState>(EMPTY_POLICY_FORM);
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      const body = parseOrThrow(createPolicyBody, {
        name,
        type,
        effectiveFrom,
        config: buildConfig(config),
        ...(reason.trim() ? { reason } : {}),
      });
      await api("/policies", { method: "POST", body });
    });
    if (ok) onSaved(`Policy ${name.trim()} created`);
  }

  return (
    <Modal title="New Policy" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="PTO Standard" />
        </Field>
        <div className="field-row">
          <Field label="Type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as TimeOffType)}>
              {timeOffTypes.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effective from">
            <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
        </div>
        <PolicyConfigFields value={config} onChange={setConfig} disabled={action.pending} />
        <Field label="Reason (optional)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.pending}>
            {action.pending ? "Saving..." : "Create policy"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VersionList({ versions, inForce }: { versions: PolicyVersion[]; inForce: PolicyVersion | null }) {
  return (
    <ul className="plain-list version-list">
      {[...versions]
        .sort((a, b) => b.versionNo - a.versionNo)
        .map((v) => (
          <li key={v.id}>
            <strong>Version {v.versionNo}</strong> from {v.effectiveFrom}
            {inForce?.id === v.id ? " (in force)" : ""}
            {v.reason ? <span className="muted"> - {v.reason}</span> : null}
          </li>
        ))}
    </ul>
  );
}

function EditPolicyForm({ detail, onClose, onSaved }: DoneProps & { detail: PolicyDetail }) {
  const latest = [...detail.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
  const basis = detail.inForce ?? latest;
  const [config, setConfig] = useState<PolicyFormState>(() => stateFromConfig(basis?.config));
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
  const [reason, setReason] = useState("");
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    let created: PolicyVersion | undefined;
    const ok = await action.run(async () => {
      const body = parseOrThrow(createVersionBody, { effectiveFrom, config: buildConfig(config), reason });
      created = await api<PolicyVersion>(`/policies/${detail.policy.id}/versions`, { method: "POST", body });
    });
    if (ok) onSaved(created ? `Version ${created.versionNo} saved, effective ${created.effectiveFrom}` : "Version saved");
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="note">
        <div className="note-text">
          <strong>{detail.policy.name}</strong>
          <span className="muted">
            {TYPE_LABELS[detail.policy.type]}. A save adds a new version, it does not edit the old one.
          </span>
        </div>
      </div>
      <VersionList versions={detail.versions} inForce={detail.inForce} />
      <div className="note note-warn">
        <div className="note-text">
          <span>
            Entries already posted do not change. The new rates count from the effective date, and later accruals use
            them.
          </span>
        </div>
      </div>
      <Field label="Effective from" hint="Today or later">
        <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>
      <PolicyConfigFields value={config} onChange={setConfig} disabled={action.pending} />
      <Field label="Reason" hint="Required, it is kept in the audit log">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={action.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={action.pending}>
          {action.pending ? "Saving..." : "Save new version"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EditPolicyModal({ policyId, onClose, onSaved }: DoneProps & { policyId: string }) {
  const detail = useApi<PolicyDetail>(`/policies/${policyId}`);
  return (
    <Modal title="Edit Policy" onClose={onClose}>
      <AsyncView state={detail}>
        {(data) => <EditPolicyForm detail={data} onClose={onClose} onSaved={onSaved} />}
      </AsyncView>
    </Modal>
  );
}
