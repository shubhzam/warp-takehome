"use client";

import { useEffect } from "react";

// a crash inside a page lands here, the shell around it stays so the nav and session still work
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(`page error: ${error.message}`);
  }, [error]);

  return (
    <section className="guard" role="alert">
      <h1>This page hit an error</h1>
      <p className="muted">{error.message}</p>
      <button type="button" className="btn btn-primary" onClick={() => retry()}>
        Try again
      </button>
    </section>
  );
}
