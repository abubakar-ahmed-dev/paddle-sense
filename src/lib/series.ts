import type { River } from "@/lib/rivers";
import {
  fetchDischarge,
  fetchDischargeRange,
  type DischargeSeries,
} from "@/lib/flood";
import { getReadings, newestObservedDate } from "@/lib/db";

export type SeriesResult = {
  series: DischargeSeries;
  /** Honest provenance: where this series actually came from */
  sourceLabel: string;
  live: boolean;
};

/** A DB reading is fresh enough to serve without hitting the live API. */
const FRESH_DAYS = 3;

function ageDays(newest: string): number {
  const now = new Date();
  const then = new Date(`${newest}T00:00:00Z`);
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

/**
 * Dashboard series: DB-first (Phase 3 architecture), live Flood API fallback.
 * The asOf/source label is mandatory — staleness is never silent (P3-5).
 */
export async function getDashboardSeries(
  river: River,
  today: string,
): Promise<SeriesResult> {
  try {
    const newest = await newestObservedDate(river.id);
    if (newest && ageDays(newest) <= FRESH_DAYS) {
      const from = daysAgoISO(14, today);
      const stored = await getReadings(river.id, from, today, "observed");
      if (stored.time.length > 0) {
        return {
          series: stored,
          sourceLabel: `GloFAS via Tiger Data (stored, through ${newest})`,
          live: false,
        };
      }
    }
  } catch {
    // fall through to live API — degradation matrix, ARCH §8
  }
  return {
    series: await fetchDischarge(river.cell.lat, river.cell.lon),
    sourceLabel: "GloFAS via Open-Meteo Flood API (live)",
    live: true,
  };
}

/** River-detail history: DB-first for the selected window, live fallback. */
export async function getRiverHistory(
  river: River,
  days: number,
  today: string,
): Promise<SeriesResult> {
  const start = daysAgoISO(days, today);
  try {
    const newest = await newestObservedDate(river.id);
    if (newest && ageDays(newest) <= FRESH_DAYS) {
      const stored = await getReadings(river.id, start, today, "observed");
      if (stored.time.length > 0) {
        return {
          series: stored,
          sourceLabel: `GloFAS via Tiger Data (stored, through ${newest})`,
          live: false,
        };
      }
    }
  } catch {
    // fall through
  }
  return {
    series: await fetchDischargeRange(river.cell.lat, river.cell.lon, start, today),
    sourceLabel: "GloFAS via Open-Meteo Flood API (live)",
    live: true,
  };
}

export function daysAgoISO(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Same calendar window one year earlier, DB-only (P75-9). No live fallback:
 * a missing last-year line is honest absence, never a fetch. Returns null
 * when the DB has no rows for that window.
 */
export async function getLastYearSeries(
  river: River,
  today: string,
  days: number,
): Promise<DischargeSeries | null> {
  const to = shiftYear(today, -1);
  const from = daysAgoISO(days, to);
  try {
    const stored = await getReadings(river.id, from, to, "observed");
    return stored.time.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD shifted by whole years (Feb 29 → Feb 28 on non-leap years). */
export function shiftYear(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const year = d.getUTCFullYear() + years;
  const probe = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
  return probe.toISOString().slice(0, 10);
}
