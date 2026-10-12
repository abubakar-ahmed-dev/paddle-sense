import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";
import { executeCycle, type CycleReport } from "./cycle";

// Re-exported for the client/worker typing (scheduleAction, tests).
export type { CycleReport, RiverReport } from "./cycle";

/**
 * weeklyCycle (ARCH §3.6 / §4.1): the weekly heartbeat. Per-river work is
 * sequential and isolated — one river failing never blocks the others
 * (same philosophy as the scout/summarize cycles). Activities retry with
 * backoff before their failure surfaces here; the workflow then reports
 * the error in the cycle summary instead of dying on it.
 *
 * The step sequence lives in workers/cycle.ts (executeCycle) so the
 * worker-internal durable loop (D5 addendum, production free tier) runs
 * byte-identical orchestration.
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

export async function weeklyCycle(riverIds: string[]): Promise<CycleReport> {
  return executeCycle(riverIds, {
    scoutCycle: () => act.scoutCycle(),
    fetchAndStoreRiver: (id) => act.fetchAndStoreRiver(id),
    predictRiver: (id) => act.predictRiver(id),
    summarizeCycle: () => act.summarizeCycle(),
    notifyRiver: (input) => act.notifyRiver(input),
  });
}
