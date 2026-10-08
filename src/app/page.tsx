import { connection } from "next/server";
import { RIVERS } from "@/lib/rivers";
import {
  currentDischarge,
  fetchDischarge,
  weekBand,
  type DischargeSeries,
} from "@/lib/flood";
import RiverChart from "./_components/RiverChart";

// Live river data: this route renders per request, not prerendered.
export const instant = false;

type RiverData = {
  river: (typeof RIVERS)[number];
  series: DischargeSeries;
  error?: string;
};

function fmt(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function status(river: (typeof RIVERS)[number], q: number | null): string {
  if (q === null) return "no data";
  if (river.runnableRange === null) return "range not yet verified";
  const [lo, hi] = river.runnableRange;
  if (q <= lo) return "below runnable — dry";
  if (q >= hi) return "high water — dangerous, do not go";
  return "in runnable range";
}

export default async function Home() {
  // Live data page: always render at request time.
  await connection();
  const today = new Date().toISOString().slice(0, 10);
  const results: RiverData[] = await Promise.all(
    RIVERS.map(async (river) => {
      try {
        const series = await fetchDischarge(river.cell.lat, river.cell.lon);
        return { river, series };
      } catch (e) {
        return {
          river,
          series: { time: [], discharge: [] },
          error: e instanceof Error ? e.message : "fetch failed",
        };
      }
    }),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-slate-200">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          When can I paddle?
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          River-level watcher for Pakistan&apos;s paddling waters. Live GloFAS
          discharge via the Open-Meteo Flood API — free, open, no account.
          Runnable ranges arrive from operator sources via live search; the
          forecast window comes next.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {results.map(({ river, series, error }) => {
          const q = currentDischarge(series);
          const band = weekBand(series);
          return (
            <section
              key={river.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-xl font-semibold">
                  {river.name}{" "}
                  <span className="text-sm font-normal text-slate-400">
                    — {river.stretch}
                  </span>
                </h2>
                <p className="font-mono text-lg text-sky-400">
                  {q === null ? "—" : `${fmt(q)} m³/s`}
                </p>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Status: <span className="text-slate-200">{status(river, q)}</span>
                {band && q !== null && (
                  <>
                    {" · "}week band {fmt(band[0])}–{fmt(band[1])} m³/s
                  </>
                )}
                {" · "}
                <span className="font-mono text-xs text-slate-500">
                  GloFAS cell {river.cell.lat}, {river.cell.lon} (
                  {river.cellElevation} m)
                </span>
              </p>
              {error ? (
                <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
                  {error}
                </p>
              ) : (
                <div className="mt-4">
                  <RiverChart series={series} today={today} />
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {river.note}
                {river.runnableRange === null && (
                  <> Runnable range: pending verification from operator sources.</>
                )}
              </p>
            </section>
          );
        })}
      </div>

      <footer className="mt-10 border-t border-slate-800 pt-4 text-xs text-slate-500">
        Data: Copernicus GloFAS v4 via the free Open-Meteo Flood API. Grid-based
        estimates, not gauge measurements — always confirm with local sources
        before going on the water.
      </footer>
    </main>
  );
}
