"use client";

import { useState, type FormEvent } from "react";
import { useSession } from "../lib/session";
import type { Role, Session } from "../lib/session-store";
import { isGuid } from "../lib/validation";
import { Field } from "./ui";

const DEFAULT_USER: Record<Role, string> = { ADMIN: "admin_1", EMPLOYEE: "emp_2201" };

type Props = {
  initial: Session | null;
  // why the last session stopped working, for example a 401 from the api
  notice?: string | null;
  onCancel?: () => void;
};

export function SessionForm({ initial, notice, onCancel }: Props) {
  const { signIn } = useSession();
  const [companyId, setCompanyId] = useState(initial?.companyId ?? "");
  const [userId, setUserId] = useState(initial?.userId ?? DEFAULT_USER.ADMIN);
  const [role, setRole] = useState<Role>(initial?.role ?? "ADMIN");
  const [error, setError] = useState<string | null>(null);

  // the demo user follows the role until someone types their own id
  function changeRole(next: Role) {
    if (userId === DEFAULT_USER[role]) setUserId(DEFAULT_USER[next]);
    setRole(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const company = companyId.trim();
    const user = userId.trim();
    if (!isGuid(company)) {
      setError("Company id must be a guid, like 0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10");
      return;
    }
    if (!user) {
      setError("User id is required");
      return;
    }
    signIn({ companyId: company, userId: user, role });
    onCancel?.();
  }

  return (
    <section className="card session-card">
      <h1>Choose a session</h1>
      <p className="muted">
        The API takes the company, user and role from headers. Run <code>bash apps/api/scripts/seed-demo.sh</code> to
        create a demo company and copy the company id it prints.
      </p>
      {notice ? (
        <div className="note note-danger" role="alert">
          {notice}
        </div>
      ) : null}
      <form className="stack" onSubmit={submit}>
        <Field label="Company id">
          <input
            className="input mono"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="0198f1c0-4b2e-7d55-8c03-9e7a1f2b6d10"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="field-row">
          <Field label="User id" hint={role === "EMPLOYEE" ? "For an employee this is the employee id" : undefined}>
            <input
              className="input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Role">
            <select className="input" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
              <option value="ADMIN">ADMIN</option>
              <option value="EMPLOYEE">EMPLOYEE</option>
            </select>
          </Field>
        </div>
        {error ? (
          <div className="note note-danger" role="alert">
            {error}
          </div>
        ) : null}
        <div className="actions">
          <button type="submit" className="btn btn-primary">
            Use this session
          </button>
          {onCancel ? (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
