import { connection } from "next/server";
import Link from "next/link";
import { RIVERS } from "@/lib/rivers";
import { currentDischarge, weekBand, type DischargeSeries } from "@/lib/flood";
import { getDashboardSeries, getLastYearSeries } from "@/lib/series";
import { computeStatus } from "@/lib/status";
import { fallbackSentence } from "@/lib/llm";
import { getLatestSummary, type SummaryRow } from "@/lib/db";
import RiverChart from "./_components/RiverChart";
import StatusBadge from "./_components/StatusBadge";
import ProvenanceFooter from "./_components/ProvenanceFooter";
import ErrorPanel from "./_components/ErrorPanel";
import SummarySentence from "./_components/SummarySentence";
import SeasonStrip from "./_components/SeasonStrip";

// Live river data: this route renders per request, not prerendered.
export const instant = false;

type RiverData = {
  river: (typeof RIVERS)[number];
  series: DischargeSeries;
  sourceLabel: string;
  summary: SummaryRow | null;
  lastYear: DischargeSeries | null;
  error?: string;
};

function fmt(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

export default async function Home() {
  await connection();
  const today = new Date().toISOString().slice(0, 10);
  const results: RiverData[] = await Promise.all(
    RIVERS.map(async (river) => {
      try {
        const { series, sourceLabel } = await getDashboardSeries(river, today);
        // Cached Gemma sentence (Phase 6); any DB failure renders the
        // deterministic fallback — the request path never calls the LLM.
        let summary: SummaryRow | null = null;
        try {
          summary = await getLatestSummary(river.id);
        } catch {
          summary = null;
        }
        // Same days last year (P75-9): DB-only, absent honestly
        const lastYear = await getLastYearSeries(river, today, 14);
        return { river, series, sourceLabel, summary, lastYear };
      } catch (e) {
        return {
          river,
          series: { time: [], discharge: [] },
          sourceLabel: "",
          summary: null,
          lastYear: null,
          error: e instanceof Error ? e.message : "fetch failed",
        };
      }
    }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">When can I paddle?</h1>
        <p className="mt-2 text-sm text-silt-dim">
          River-level watcher for Pakistan&apos;s paddling waters. Live GloFAS
          discharge via the Open-Meteo Flood API — free, open, no account.
          Runnable ranges arrive from operator sources via live search; the
          forecast window comes next.{" "}
          <Link href="/about" className="text-ochre underline decoration-ochre/40 underline-offset-2 hover:text-ochre-deep">
            How to read this
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {results.map(({ river, series, sourceLabel, summary, lastYear, error }) => {
          const q = currentDischarge(series);
          const band = weekBand(series);
          const status = computeStatus({
            discharge: q,
            rangeState: river.rangeState,
            runnable: river.runnableRange,
          });
          return (
            <section
              key={river.id}
              className="rounded-2xl border border-stone-edge bg-stone/60 p-5 sm:p-6"
            >
              {/* 1 — identity + level: the two things read first. Name over
                  stretch (own line, no wrap fight); level is the card's
                  biggest number with its unit one size down. */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold leading-tight">
                    <Link href={`/river/${river.id}`} className="hover:text-ochre">
                      {river.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-silt-dim">
                    {river.stretch}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-2xl leading-none text-ochre">
                    {q === null ? "—" : fmt(q)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-silt-dim">m³/s now</p>
                </div>
              </div>

              {/* 2 — status: badge + week band, the only line between
                  identity and chart. */}
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusBadge status={status} />
                {band && q !== null && (
                  <span className="text-sm text-silt-dim">
                    week band{" "}
                    <span className="font-mono text-silt">
                      {fmt(band[0])}–{fmt(band[1])}
                    </span>{" "}
                    m³/s
                  </span>
                )}
              </p>

              {error ? (
                <div className="mt-4">
                  <ErrorPanel message={`Could not load live data: ${error}`} />
                </div>
              ) : (
                <div className="mt-4">
                  <SeasonStrip today={today} />
                  <RiverChart series={series} today={today} lastYear={lastYear} />
                </div>
              )}

              {/* 3 — interpretation zone: one quiet separator, then the
                  summary sentence, the honesty note, and provenance. The
                  "pending verification" sentence is gone — the badge
                  already says it. */}
              <div className="mt-4 border-t border-stone-edge/60 pt-3">
                <SummarySentence
                  summary={
                    summary
                      ? {
                          text: summary.text,
                          statusWord: summary.statusWord,
                          generatedBy: summary.generatedBy,
                          cycleDate: summary.cycleDate,
                        }
                      : null
                  }
                  fallback={fallbackSentence(status, {
                    name: river.name,
                    level: q,
                    runnable: river.runnableRange,
                  })}
                />
                <p className="mt-2 text-xs leading-relaxed text-silt-dim">
                  {river.note}
                </p>
                <div className="mt-3">
                  <ProvenanceFooter
                    items={[
                      {
                        label: `GloFAS cell ${river.cell.lat}, ${river.cell.lon} (${river.cellElevation} m) · ${sourceLabel}`,
                        url: "https://open-meteo.com/en/docs/flood-api",
                        asOf: today,
                      },
                    ]}
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-10">
        <ProvenanceFooter
          items={[
            {
              label: "Data: Copernicus GloFAS v4 via the free Open-Meteo Flood API",
              url: "https://open-meteo.com/en/docs/flood-api",
              asOf: today,
            },
          ]}
        />
      </div>
    </div>
  );
}
