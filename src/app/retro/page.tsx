import type { Metadata } from "next";
import Link from "next/link";
import EmptyState from "@/app/_components/EmptyState";

export const metadata: Metadata = {
  title: "Retrodiction — PaddleSense",
  description:
    "Past predictions vs recorded reality: how we prove (or disprove) the forecast.",
};

/**
 * SHELL (Phase 2): layout + explainer + clearly-labeled illustrative sample.
 * Real predictions and metrics arrive with the Phase 4 backtest harness.
 * Honesty rule: sample numbers are marked SAMPLE everywhere they appear.
 */
export default function RetroPage() {
  const sample = {
    river: "Indus — Besham stretch",
    model_version: "sample-only",
    mae: "96.4 m³/s",
    coverage: "78.6%",
    rows: [
      { date: "2026-09-10", lo: "2,180", high: "2,510", actual: "2,311", covered: true },
      { date: "2026-09-11", lo: "2,150", high: "2,480", actual: "2,296", covered: true },
      { date: "2026-09-12", lo: "2,120", high: "2,450", actual: "2,587", covered: false },
      { date: "2026-09-13", lo: "2,090", high: "2,420", actual: "2,301", covered: true },
      { date: "2026-09-14", lo: "2,060", high: "2,390", actual: "2,198", covered: true },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Retrodiction</h1>
        <p className="mt-2 text-sm text-silt-dim">
          The forecast must earn trust the checkable way: we hide the last four
          weeks of a river&apos;s recorded data, predict them from earlier
          history only, then plot the prediction band against what actually
          happened. Misses are shown, never hidden.{" "}
          <Link href="/about" className="text-ochre hover:text-ochre-deep">
            Why bands, not points
          </Link>
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-attention/40 bg-attention/10 p-3 text-sm text-silt">
        <strong className="font-semibold">Illustrative sample.</strong> The
        numbers below demonstrate the layout — real predictions and metrics
        arrive with the Phase 4 backtest harness. Until then, forecasts are{" "}
        <em>not yet claimed</em> anywhere in the product.
      </div>

      <section className="rounded-2xl border border-stone-edge bg-stone/60 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{sample.river}</h2>
          <span className="rounded-full border border-attention/40 px-2.5 py-0.5 text-xs font-medium text-attention">
            SAMPLE
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-silt-dim">Model</dt>
            <dd className="font-mono text-silt">{sample.model_version}</dd>
          </div>
          <div>
            <dt className="text-xs text-silt-dim">Mean absolute error</dt>
            <dd className="font-mono text-silt">{sample.mae}</dd>
          </div>
          <div>
            <dt className="text-xs text-silt-dim">Band coverage</dt>
            <dd className="font-mono text-silt">{sample.coverage}</dd>
          </div>
        </dl>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-xs">
            <caption className="sr-only">
              Sample retrodiction: predicted band versus recorded discharge
            </caption>
            <thead>
              <tr className="text-silt-dim">
                <th scope="col" className="border-b border-stone-edge py-2 pr-4 font-normal">Date</th>
                <th scope="col" className="border-b border-stone-edge py-2 pr-4 font-normal">Predicted band (m³/s)</th>
                <th scope="col" className="border-b border-stone-edge py-2 pr-4 font-normal">Recorded</th>
                <th scope="col" className="border-b border-stone-edge py-2 font-normal">In band</th>
              </tr>
            </thead>
            <tbody>
              {sample.rows.map((row) => (
                <tr key={row.date}>
                  <td className="border-b border-stone-edge/50 py-2 pr-4">{row.date}</td>
                  <td className="border-b border-stone-edge/50 py-2 pr-4 text-water">
                    {row.lo} – {row.high}
                  </td>
                  <td className="border-b border-stone-edge/50 py-2 pr-4">{row.actual}</td>
                  <td className="border-b border-stone-edge/50 py-2">
                    {row.covered ? "yes" : <span className="text-danger">no — miss shown</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <EmptyState
          what="Per-river backtests have not run yet"
          why="Real predicted-vs-actual charts for all four rivers arrive in Phase 4. This page will never re-compute on request — it only shows stored, reviewed results."
        />
      </section>
    </div>
  );
}
