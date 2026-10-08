"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <div role="alert" className="rounded-2xl border border-danger/50 bg-danger-deep/30 p-6">
        <h1 className="text-lg font-semibold">Something broke while loading</h1>
        <p className="mt-2 text-sm text-silt-dim">
          The error was: {error.message || "unknown error"}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md border border-danger/50 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
