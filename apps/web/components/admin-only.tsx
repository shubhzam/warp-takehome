"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "../lib/session";

// the api keeps enforcing roles, this only gives an employee a clear screen instead of a page of 403s
export function AdminOnly({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (session?.role === "ADMIN") return <>{children}</>;
  return (
    <section className="guard">
      <h1>This page is for admins</h1>
      <p className="muted">
        You are signed in as {session?.userId ?? "an employee"}. Admin pages call endpoints that only accept the ADMIN role.
      </p>
      <Link className="btn btn-primary" href="/time-off">
        Go to my time off
      </Link>
    </section>
  );
}
