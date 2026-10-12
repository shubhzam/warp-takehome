import Link from "next/link";

export default function NotFound() {
  return (
    <section className="guard">
      <h1>Page not found</h1>
      <p className="muted">There is nothing at this address.</p>
      <Link className="btn btn-primary" href="/">
        Back to the console
      </Link>
    </section>
  );
}
