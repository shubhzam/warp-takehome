"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession } from "../lib/session";
import type { Role } from "../lib/session-store";
import { shortId } from "../lib/format";
import { SessionForm } from "./session-form";

const DEMO_NOTE = "Demo session: the API trusts these headers. Production sits behind real authentication.";

const NAV: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: "/policies", label: "Policies" },
    { href: "/requests", label: "Requests" },
    { href: "/employees", label: "Employees" },
    { href: "/calendars", label: "Holidays" },
    { href: "/operations", label: "Operations" },
    { href: "/audit", label: "Audit log" },
  ],
  EMPLOYEE: [{ href: "/time-off", label: "My time off" }],
};

function SideNav({ role, pathname }: { role: Role; pathname: string }) {
  return (
    <nav className="sidenav" aria-label="Main">
      {NAV[role].map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={active ? "navlink navlink-active" : "navlink"}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const state = useSession();
  const pathname = usePathname();
  const [switching, setSwitching] = useState(false);
  const { session } = state;

  let body: ReactNode;
  if (!state.loaded) {
    body = <p className="muted">Loading...</p>;
  } else if (!session || switching) {
    body = (
      <SessionForm
        initial={session ?? state.previous}
        notice={session ? null : state.notice}
        onCancel={session ? () => setSwitching(false) : undefined}
      />
    );
  } else {
    body = children;
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Time off</span>
        </Link>
        {session ? (
          <div className="session-chip">
            <span className="session-text" title={session.companyId}>
              {session.userId}
              <span className="session-sep"> / </span>
              {session.role}
              <span className="session-sep"> / </span>
              <span className="mono">{shortId(session.companyId)}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setSwitching(true)}>
              Switch
            </button>
          </div>
        ) : null}
      </header>
      <p className="demo-banner">{DEMO_NOTE}</p>
      {state.unreachable ? (
        <div className="note note-warn app-note" role="alert">
          Could not reach the API for <code>/api{state.unreachable}</code>. Check that it is running on port 4000, or set
          API_URL for the web app. This clears on the next call that works.
        </div>
      ) : null}
      <div className={session ? "frame" : "frame frame-single"}>
        {session ? <SideNav role={session.role} pathname={pathname} /> : null}
        <main className="content">{body}</main>
      </div>
    </div>
  );
}
