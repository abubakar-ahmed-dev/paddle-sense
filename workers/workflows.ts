import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";
import type * as activities from "./activities";

/** Surface the real cause through Temporal's failure wrapping. */
function errMessage(e: unknown): string {
  if (e instanceof ApplicationFailure) return e.message || e.type || "activity failed";
  if (e instanceof Error) {
    return e.cause instanceof Error ? e.cause.message : e.message;
  }
  return "activity failed";
}

/**
 * weeklyCycle (ARCH §3.6 / §4.1): the weekly heartbeat. Per-river work is
 * sequential and isolated — one river failing never blocks the others
 * (same philosophy as the scout/summarize cycles). Activities retry with
 * backoff before their failure surfaces here; the workflow then reports
 * the error in the cycle summary instead of dying on it.
 */

export const TASK_QUEUE = "paddle-sense";

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2.0,
  },
});

export type RiverReport = {
  riverId: string;
  stored: number;
  predicted: boolean;
  notified: boolean;
  error?: string;
};

export type CycleReport = {
  scoutRan: boolean;
  scoutError?: string;
  summarizeError?: string;
  rivers: RiverReport[];
  summariesStored: number;
  emailsSent: string[];
};

export async function weeklyCycle(riverIds: string[]): Promise<CycleReport> {
  const report: CycleReport = {
    scoutRan: false,
    rivers: [],
    summariesStored: 0,
    emailsSent: [],
  };

  // Scout: ledger-capped and cache-backed; a budget stop is normal, not fatal.
  try {
    await act.scoutCycle();
    report.scoutRan = true;
  } catch (e) {
    report.scoutError = errMessage(e);
  }

  for (const riverId of riverIds) {
    const row: RiverReport = { riverId, stored: 0, predicted: false, notified: false };
    try {
      row.stored = (await act.fetchAndStoreRiver(riverId)).stored;
      row.predicted = (await act.predictRiver(riverId)).predicted;
    } catch (e) {
      row.error = errMessage(e);
    }
    report.rivers.push(row);
  }

  let summaries: Awaited<ReturnType<typeof act.summarizeCycle>>["rivers"] = [];
  try {
    const result = await act.summarizeCycle();
    summaries = result.rivers;
  } catch (e) {
    report.summarizeError = errMessage(e);
  }

  for (const s of summaries) {
    if (s.stored) report.summariesStored += 1;
    try {
      const n = await act.notifyRiver({ riverId: s.riverId, summaryStored: s.stored });
      if (n.sent) {
        report.emailsSent.push(s.riverId);
        const row = report.rivers.find((r) => r.riverId === s.riverId);
        if (row) row.notified = true;
      }
    } catch {
      // a missed nudge is logged-by-absence, never fatal (P7-5)
    }
  }

  return report;
}
