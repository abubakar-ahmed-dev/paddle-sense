import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
  Client,
  Workflow,
  ScheduleHandle,
  type ScheduleSpec,
  type ScheduleOptionsStartWorkflowAction,
} from "@temporalio/client";
import * as activities from "./activities";
import { weeklyCycle, TASK_QUEUE } from "./workflows";
import { executeCycle } from "./cycle";

/**
 * PaddleSense watcher worker (Phase 7, ARCH §3.6, DEPLOYMENT.md).
 *
 * Boot gate first: stale migrations or missing env refuse to start (the
 * worker must never silently write against a schema it does not understand).
 *
 * Two execution paths (D5 addendum, TECHNICAL_ARCHITECTURE §6), chosen by
 * WORKER_MODE — explicit, because guessing a durability model from an env
 * var's absence is how dev silently stops using Temporal:
 * - `temporal` (default): connect, ensure the weekly schedule exists
 *   (create-or-update, idempotent), run the worker.
 *   Dev server: `npm run temporal:dev` (CLI binary, SQLite-persisted,
 *   UI on :8233) — TEMPORAL_ADDRESS defaults to localhost:7233.
 * - `loop`: production durable loop. A free Render worker cannot host a
 *   Temporal server, so the cycle runs in-process — same activities
 *   (executeCycle), a catch-up run at boot (idempotent:
 *   skip-if-done-today makes re-runs no-ops), then a self-re-arming timer
 *   for Mondays 06:17 UTC.
 */

const SCHEDULE_ID = "weekly-cycle";
// Monday morning, off the hour (free-tier politeness)
const SCHEDULE_SPEC: ScheduleSpec = {
  calendars: [{ dayOfWeek: "MONDAY", hour: 6, minute: 17 }],
};

function scheduleAction(): ScheduleOptionsStartWorkflowAction<Workflow> {
  return {
    type: "startWorkflow",
    workflowType: weeklyCycle,
    taskQueue: TASK_QUEUE,
    args: [activities.allRiverIds()],
  };
}

async function ensureSchedule(client: Client): Promise<void> {
  const handle: ScheduleHandle = client.schedule.getHandle(SCHEDULE_ID);
  try {
    await handle.describe();
    // Config is the source of truth — refresh spec + action on every boot.
    await handle.update((previous) => ({
      spec: { ...previous.spec, ...SCHEDULE_SPEC },
      action: scheduleAction(),
      state: {},
    }));
    console.log(`[worker] schedule "${SCHEDULE_ID}" already exists — spec refreshed (Mondays 06:17 UTC)`);
  } catch {
    await client.schedule.create({
      scheduleId: SCHEDULE_ID,
      spec: SCHEDULE_SPEC,
      action: scheduleAction(),
    });
    console.log(`[worker] schedule "${SCHEDULE_ID}" created (Mondays 06:17 UTC)`);
  }
}

/** ms from now until the next Monday 06:17:00 UTC. */
export function msUntilNextMonday0617(now: Date = new Date()): number {
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 17, 0, 0),
  );
  let addDays = (1 - now.getUTCDay() + 7) % 7;
  if (addDays === 0 && now.getTime() >= target.getTime()) addDays = 7;
  target.setUTCDate(target.getUTCDate() + addDays);
  return target.getTime() - now.getTime();
}

async function runDurableLoop(): Promise<void> {
  console.log("[worker] WORKER_MODE=loop — production durable loop (D5 addendum)");
  const runCycle = async () => {
    const started = new Date().toISOString();
    console.log(`[worker] cycle start ${started}`);
    try {
      const report = await executeCycle(activities.allRiverIds(), {
        scoutCycle: () => activities.scoutCycle(),
        fetchAndStoreRiver: (id) => activities.fetchAndStoreRiver(id),
        predictRiver: (id) => activities.predictRiver(id),
        summarizeCycle: () => activities.summarizeCycle(),
        notifyRiver: (input) => activities.notifyRiver(input),
      });
      console.log(`[worker] cycle done: ${JSON.stringify(report)}`);
    } catch (e) {
      // executeCycle isolates per-river failures; a throw here means the
      // environment broke (config/DB) — log loudly, stay alive, retry next tick.
      console.error(`[worker] cycle crashed: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Boot catch-up: if the process restarted mid-week, an immediate run is a
  // no-op for everything already stored today (upserts, skip-if-done-today,
  // cache-before-call) and heals anything the crashed run left behind.
  await runCycle();

  const arm = () => {
    const ms = msUntilNextMonday0617();
    console.log(`[worker] next cycle in ${Math.round(ms / 3_600_000)}h (Mondays 06:17 UTC)`);
    setTimeout(() => {
      void runCycle().then(arm);
    }, ms);
  };
  arm();

  const shutdown = (signal: string) => {
    console.log(`[worker] received ${signal}, stopping (loop state is in the DB — nothing to drain)`);
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function main() {
  console.log("[worker] boot gate: checking env + migrations");
  const warnings = await activities.bootGate();
  for (const w of warnings) console.warn(`[worker] ${w}`);

  if ((process.env.WORKER_MODE ?? "temporal") === "loop") {
    await runDurableLoop();
    return;
  }

  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const client = new Client({ connection });
  await ensureSchedule(client);

  const worker = await Worker.create({
    connection,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities,
  });

  console.log(`[worker] heartbeat: running task queue "${TASK_QUEUE}" — weekly cycle scheduled, waiting for ticks`);
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, draining…`);
    worker.shutdown();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await worker.run();
  await connection.close();
  console.log("[worker] stopped cleanly");
}

main().catch((e) => {
  console.error(`[worker] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
