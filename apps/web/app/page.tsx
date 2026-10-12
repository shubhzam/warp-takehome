"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../lib/session";
import type { Role } from "../lib/session-store";

const HOME: Record<Role, string> = { ADMIN: "/policies", EMPLOYEE: "/time-off" };

// the shell shows the session form when there is no session, so this only runs for a signed in user
export default function Home() {
  const { session } = useSession();
  const router = useRouter();
  const target = session ? HOME[session.role] : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return <p className="muted">Loading...</p>;
}
