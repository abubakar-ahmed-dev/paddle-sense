/**
 * Cycle orchestration, shared by both execution paths (D5 addendum):
 * - Temporal workflow (dev/tests): `weeklyCycle` wires these steps through
 *   proxyActivities for retries and durability.
 * - Worker-internal durable loop (production free tier): the same steps run
 *   in-process — a 512 MB Render worker cannot host a Temporal server, and
 *   safety there comes from the same properties: idempotent activities,
 *   skip-if-done-today, boot gate.
 * Pure orchestration only: no node imports, activity implementations are
 * injected — this file stays importable from the workflow bundle.
 */

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

export type CycleDeps = {
  scoutCycle: () => Promise<unknown>;
  fetchAndStoreRiver: (id: string) => Promise<{ stored: number }>;
  predictRiver: (id: string) => Promise<{ predicted: boolean }>;
  summarizeCycle: () => Promise<{ rivers: { riverId: string; stored: boolean }[] }>;
  notifyRiver: (input: {
    riverId: string;
    summaryStored: boolean;
  }) => Promise<{ sent: boolean }>;
};

/** Surface the real cause through retry wrappers (Temporal or plain). */
export function errMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.cause instanceof Error ? e.cause.message : e.message;
  }
  return typeof e === "string" ? e : "activity failed";
}

export async function executeCycle(
  riverIds: string[],
  act: CycleDeps,
): Promise<CycleReport> {
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

  let summaries: Awaited<ReturnType<CycleDeps["summarizeCycle"]>>["rivers"] = [];
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
