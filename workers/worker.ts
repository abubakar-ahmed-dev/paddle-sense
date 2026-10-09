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

/**
 * PaddleSense watcher worker (Phase 7, ARCH §3.6, DEPLOYMENT.md).
 *
 * Boot gate first: stale migrations or missing env refuse to start (the
 * worker must never silently write against a schema it does not understand).
 * Then: connect, ensure the weekly schedule exists (create-or-update,
 * idempotent), run the worker until SIGINT/SIGTERM.
 *
 * Dev server: `npm run temporal:dev` (Temporal CLI binary, SQLite-persisted
 * under .cache/ so schedules survive restarts). UI: http://localhost:8233
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

async function main() {
  console.log("[worker] boot gate: checking env + migrations");
  const warnings = await activities.bootGate();
  for (const w of warnings) console.warn(`[worker] ${w}`);

  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
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
