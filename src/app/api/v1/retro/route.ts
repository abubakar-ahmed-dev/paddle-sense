import { NextRequest, NextResponse } from "next/server";
import { getLatestBacktest } from "@/lib/db";

/**
 * GET /api/v1/retro?river_id=&window=28 — stored backtest results
 * (docs/API.md §2.4). Never recomputes: reads the newest `predictions`
 * run (kind='backtest'); `window` only slices the day list, the metrics
 * stay the stored run's.
 */

export async function GET(request: NextRequest) {
  const riverId = request.nextUrl.searchParams.get("river_id");
  if (!riverId) {
    return NextResponse.json(
      { error: { code: "river_not_found", message: "river_id query parameter is required" } },
      { status: 400 },
    );
  }
  const window = Math.max(
    1,
    Math.min(365, Number(request.nextUrl.searchParams.get("window") ?? 28) || 28),
  );

  let run;
  try {
    run = await getLatestBacktest(riverId);
  } catch {
    return NextResponse.json(
      { error: { code: "storage_unavailable", message: "could not read stored predictions" } },
      { status: 503 },
    );
  }
  if (!run) {
    return NextResponse.json(
      { error: { code: "river_not_found", message: `No stored backtest for '${riverId}'` } },
      { status: 404 },
    );
  }

  const days = run.days.slice(-window).map((d) => ({
    date: d.date,
    band_lo: d.bandLo,
    band_high: d.bandHigh,
    actual: d.actual,
    covered: d.covered,
  }));
  const metrics = (run.metrics ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    river_id: riverId,
    window_days: days.length,
    model_version: run.modelVersion,
    metrics: { mae: metrics.mae, band_coverage: metrics.band_coverage },
    days,
  });
}
