import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import EmptyState from "@/app/_components/EmptyState";
import MetricRow from "@/app/_components/MetricRow";
import RetroBandChart from "@/app/_components/RetroBandChart";
import { getLatestBacktest, listRivers, type RetroRun } from "@/lib/db";

export const metadata: Metadata = {
  title: "Retrodiction — PaddleSense",
  description:
    "Past predictions vs recorded reality: how we prove (or disprove) the forecast.",
};

// Levels are stored, but the page must reflect the newest stored run at
// request time — same blocking-dynamic model as the dashboard (ARCH §3.1).
export const instant = false;

/**
 * LIVE (Phase 4): reads the newest stored backtest run per river. It never
 * recomputes on request (DATA_DICTIONARY §5) — if a river has no run yet,
 * it says so instead of guessing.
 */
export default async function RetroPage() {
  await connection();
  const rivers = await listRivers();
  const runs = new Map<string, RetroRun | null>(
    await Promise.all(
      rivers.map(async (r) => [r.id, await getLatestBacktest(r.id)] as const),
    ),
  );
  const withRuns = rivers.filter((r) => runs.get(r.id) !== null);
  const withoutRuns = rivers.filter((r) => runs.get(r.id) === null);

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

      {withRuns.length === 0 && (
        <EmptyState
          what="First backtest has not run yet"
          why="Predicted-vs-actual charts appear once the backtest harness has stored a run. This page will never re-compute on request — it only shows stored, reviewed results."
        />
      )}

      {withRuns.map((river) => {
        const run = runs.get(river.id)!;
        const metrics = (run.metrics ?? {}) as {
          mae?: number;
          band_coverage?: number;
          trained_through?: string;
          hidden_window?: { from?: string; to?: string };
        };
        const covered = run.days.filter((d) => d.covered).length;
        return (
          <section
            key={river.id}
            className="mb-6 rounded-2xl border border-stone-edge bg-stone/60 p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold">
                {river.name} — {river.stretch}
              </h2>
              <span className="font-mono text-xs text-silt-dim">{river.id}</span>
            </div>

            <div className="mt-4">
              <MetricRow
                modelVersion={run.modelVersion}
                mae={typeof metrics.mae === "number" ? metrics.mae : null}
                coverage={
                  typeof metrics.band_coverage === "number" ? metrics.band_coverage : null
                }
              />
            </div>

            <div className="mt-5">
              <RetroBandChart days={run.days} />
            </div>

            <p className="mt-3 text-xs text-silt-dim">
              {covered}/{run.days.length} days inside the band.{" "}
              {metrics.trained_through && metrics.hidden_window?.from && metrics.hidden_window?.to && (
                <>
                  Predicted from history through{" "}
                  <span className="font-mono">{metrics.trained_through}</span>; truth
                  from <span className="font-mono">{metrics.hidden_window.from}</span> –{" "}
                  <span className="font-mono">{metrics.hidden_window.to}</span>.
                </>
              )}{" "}
              Band target {(run.coverageTarget * 100).toFixed(0)}% by construction
              (empirical residual quantiles).
            </p>
          </section>
        );
      })}

      {withoutRuns.length > 0 && (
        <section className="mt-6">
          <EmptyState
            what={`No stored backtest yet for: ${withoutRuns.map((r) => r.name).join(", ")}`}
            why="Each river gets its own hidden-window run. Until one is stored, this page says so rather than estimating."
          />
        </section>
      )}
    </div>
  );
}
