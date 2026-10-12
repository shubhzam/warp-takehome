"use client";

import { describePolicy } from "../lib/policy-form";
import { TYPE_LABELS } from "../lib/format";
import type { PolicySummary } from "../lib/types";
import { Tag } from "./ui";

type Props = {
  policy: PolicySummary;
  onEdit: () => void;
  onAssign?: () => void;
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// the card from the brief: name, type, paid tag, accrual details and the two actions
export function PolicyCard({ policy, onEdit, onAssign }: Props) {
  const version = policy.inForce;
  const text = version ? describePolicy(version.config) : null;

  return (
    <article className="card policy-card">
      <header className="policy-head">
        <div className="policy-title">
          <h2>{policy.name}</h2>
          <Tag>{TYPE_LABELS[policy.type]}</Tag>
          <Tag tone="ok">Paid</Tag>
        </div>
        <span className="muted small">
          {version ? `Version ${version.versionNo}, from ${version.effectiveFrom}` : "No version in force yet"}
        </span>
      </header>

      {text ? (
        <section aria-label="Accrual details">
          <h3 className="section-label">Accrual Details</h3>
          <dl className="details">
            <Detail label="Schedule" value={text.schedule} />
            <Detail label="Rate" value={text.rate} />
            <Detail label="Accrues" value={text.accrues} />
            <Detail label="Unit" value={text.unit} />
          </dl>
          {text.tiers.length > 0 ? (
            <ul className="plain-list muted">
              {text.tiers.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {text.notes.length > 0 ? <p className="muted small">{text.notes.join(". ")}</p> : null}
        </section>
      ) : (
        <p className="muted">This policy starts later, open Edit Policy to see its versions.</p>
      )}

      <footer className="actions">
        <button type="button" className="btn" onClick={onEdit}>
          Edit Policy
        </button>
        {onAssign ? (
          <button type="button" className="btn" onClick={onAssign}>
            Manage Assignments
          </button>
        ) : null}
      </footer>
    </article>
  );
}
