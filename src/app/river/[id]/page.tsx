import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RIVERS } from "@/lib/rivers";
import { currentDischarge } from "@/lib/flood";
import { getRiverHistory } from "@/lib/series";
import { computeStatus } from "@/lib/status";
import { getNotes } from "@/lib/db";
import RiverChart from "@/app/_components/RiverChart";
import StatusBadge from "@/app/_components/StatusBadge";
import ProvenanceFooter from "@/app/_components/ProvenanceFooter";
import NotesList from "@/app/_components/NotesList";
import EmptyState from "@/app/_components/EmptyState";

// Live river data: rendered per request.
export const instant = false;

// Prerender shells for the curated rivers (faster first paint). Unknown ids
// render the not-found UI, but under PPR streaming the HTTP status stays 200 —
// known framework limitation, recorded in plans/phase-2-ui/implementation-logs.md.
export function generateStaticParams() {
  return RIVERS.map((river) => ({ id: river.id }));
}

const WINDOWS = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
} as const;

type WindowKey = keyof typeof WINDOWS;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmt(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

export default async function RiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  await connection();
  const { id } = await params;
  const river = RIVERS.find((r) => r.id === id);
  if (!river) notFound();

  const { range: rangeParam } = await searchParams;
  const rangeKey: WindowKey =
    rangeParam && rangeParam in WINDOWS ? (rangeParam as WindowKey) : "30d";
  const days = WINDOWS[rangeKey];

  const today = new Date().toISOString().slice(0, 10);
  const start = daysAgoISO(days);

  let series = null;
  let sourceLabel = "";
  let fetchError: string | null = null;
  try {
    const result = await getRiverHistory(river, days, today);
    series = result.series;
    sourceLabel = result.sourceLabel;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "fetch failed";
  }

  // Scouted access/closure/operator notes with provenance (Phase 5).
  // A failed read degrades to the honest empty list, never a broken page.
  let notes: Awaited<ReturnType<typeof getNotes>> = [];
  try {
    notes = await getNotes(river.id);
  } catch {
    notes = [];
  }

  const q = series ? currentDischarge(series) : null;
  const status = computeStatus({
    discharge: q,
    rangeState: river.rangeState,
    runnable: river.runnableRange,
  });

  // Peak inside the selected window
  let peak: { date: string; q: number } | null = null;
  if (series) {
    for (let i = 0; i < series.time.length; i++) {
      const v = series.discharge[i];
      if (v !== null && (!peak || v > peak.q)) peak = { date: series.time[i], q: v };
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="mb-4 text-sm">
        <Link href="/" className="text-ochre hover:text-ochre-deep">
          ← All rivers
        </Link>
      </p>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {river.name}{" "}
          <span className="text-base font-normal text-silt-dim">
            — {river.stretch}
          </span>
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-silt-dim">
          <StatusBadge status={status} />
          <span className="font-mono text-base text-ochre">
            {q === null ? "—" : `${fmt(q)} m³/s`}
          </span>
          <span>now</span>
        </p>
        <p className="mt-2 text-xs leading-relaxed text-silt-dim">{river.note}</p>
      </header>

      {/* window selector */}
      <nav aria-label="History window" className="mb-4 flex gap-2 text-sm">
        {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
          <Link
            key={key}
            href={`/river/${river.id}?range=${key}`}
            aria-current={key === rangeKey ? "true" : undefined}
            className={`rounded-full border px-3 py-1 ${
              key === rangeKey
                ? "border-ochre/60 bg-ochre/10 text-ochre"
                : "border-stone-edge text-silt-dim hover:text-ochre"
            }`}
          >
            {key}
          </Link>
        ))}
      </nav>

      {fetchError ? (
        <EmptyState
          what="Could not load history"
          why={`The Flood API call failed: ${fetchError}`}
        />
      ) : series && series.time.length > 0 ? (
        <>
          <section className="rounded-2xl border border-stone-edge bg-stone/60 p-5">
            <h2 className="mb-3 text-sm font-semibold text-silt-dim">
              Discharge, {start} → {today}
            </h2>
            <RiverChart
              series={series}
              today={today}
              height={240}
              runnable={river.rangeState === "verified" ? river.runnableRange : null}
            />
            {peak && (
              <p className="mt-3 text-sm text-silt-dim">
                Peak in window:{" "}
                <span className="font-mono text-silt">
                  {fmt(peak.q)} m³/s
                </span>{" "}
                on <span className="font-mono text-silt">{peak.date}</span>
              </p>
            )}
            {river.id === "indus-besham" && start <= "2022-07-02" && (
              <p className="mt-2 rounded-lg border border-attention/40 bg-attention/10 p-3 text-xs text-silt">
                This window contains the July 2022 flood peak from our
                validation record:{" "}
                <span className="font-mono">12,022 m³/s on 2022-07-02</span>.
              </p>
            )}
          </section>
        </>
      ) : (
        <EmptyState
          what="No readings in this window"
          why="The cell returned no data for the selected range."
        />
      )}

      {/* runnable range state */}
      <section className="mt-6 rounded-2xl border border-stone-edge bg-stone/60 p-5">
        <h2 className="text-sm font-semibold text-silt-dim">Runnable range</h2>
        {river.rangeState === "verified" && river.runnableRange ? (
          <p className="mt-2 text-sm">
            {fmt(river.runnableRange[0])} – {fmt(river.runnableRange[1])} m³/s
            <span className="ml-2 text-xs text-silt-dim">
              (verified — source linked below)
            </span>
          </p>
        ) : river.rangeState === "not_a_paddling_river" ? (
          <p className="mt-2 text-sm text-silt-dim">
            Not a paddling river — kept in the index as an honesty check.
          </p>
        ) : (
          <p className="mt-2 rounded-lg border border-attention/40 bg-attention/10 p-3 text-sm text-silt">
            Not yet verified. Ranges are only shown once a quoted operator or
            guidebook source exists — we do not invent them. See{" "}
            <Link href="/about#ranges" className="text-ochre hover:text-ochre-deep">
              how ranges get verified
            </Link>
            .
          </p>
        )}
      </section>

      {/* access & notes (UX_SPEC §4.2 item 5). Range candidates are not
          shown pre-verification — they live in the owner review path
          (npm run range-candidates) until a human promotes one (P5-4). */}
      <section className="mt-6 rounded-2xl border border-stone-edge bg-stone/60 p-5">
        <h2 className="text-sm font-semibold text-silt-dim">Access &amp; notes</h2>
        <NotesList notes={notes.filter((n) => n.kind !== "range")} />
      </section>

      <div className="mt-6">
        <ProvenanceFooter
          items={[
            {
              label: `GloFAS cell ${river.cell.lat}, ${river.cell.lon} (${river.cellElevation} m) · ${sourceLabel}`,
              url: "https://open-meteo.com/en/docs/flood-api",
              asOf: today,
            },
            {
              label: "Copernicus GloFAS / ECMWF",
              url: "https://global-flood-database.ecmwf.int",
            },
          ]}
        />
      </div>
    </div>
  );
}
