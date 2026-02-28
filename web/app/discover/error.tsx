"use client";

import { useEffect } from "react";

export default function DiscoverError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Discover route error", error);
  }, [error]);

  return (
    <main className="container">
      <section className="card">
        <h1>Discover Unavailable</h1>
        <p className="muted">
          This page hit an unexpected client error. Use retry to reload the route. If this repeats, keep filters simple and report the
          URL so we can isolate the trigger.
        </p>
        <button type="button" className="action-button" onClick={reset}>
          Retry Discover
        </button>
      </section>
    </main>
  );
}
