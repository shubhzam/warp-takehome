"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AdminOnly } from "../../components/admin-only";
import { EmployeeDetail } from "../../components/employee-detail";
import { Empty, PageHeader } from "../../components/ui";
import { rememberEmployee, useRecentEmployees } from "../../lib/recent-employees";

function SearchForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = value.trim();
    router.push(id ? `/employees?id=${encodeURIComponent(id)}` : "/employees");
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Employee id, for example emp_2201"
        aria-label="Employee id"
        spellCheck={false}
      />
      <button type="submit" className="btn btn-primary">
        Look up
      </button>
    </form>
  );
}

function Lookup() {
  const params = useSearchParams();
  const id = (params.get("id") ?? "").trim();
  const recent = useRecentEmployees();

  useEffect(() => {
    if (id) rememberEmployee(id);
  }, [id]);

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="There is no employee directory here, type an id. The ids this console has seen are remembered."
        actions={<SearchForm key={id} initial={id} />}
      />
      {recent.length > 0 ? (
        <nav className="chips" aria-label="Recent employees">
          {recent.map((r) => (
            <Link key={r} href={`/employees?id=${encodeURIComponent(r)}`} className={r === id ? "segment segment-on" : "segment"}>
              {r}
            </Link>
          ))}
        </nav>
      ) : null}
      {id ? <EmployeeDetail key={id} employeeId={id} /> : <Empty>Enter an employee id to see balances, ledger and schedule.</Empty>}
    </>
  );
}

export default function EmployeesPage() {
  return (
    <AdminOnly>
      <Suspense fallback={<p className="muted">Loading...</p>}>
        <Lookup />
      </Suspense>
    </AdminOnly>
  );
}
