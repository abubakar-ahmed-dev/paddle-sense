// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { weeklyCycle, TASK_QUEUE, type CycleReport } from "../../workers/workflows";
import type * as activities from "../../workers/activities";

/**
 * Phase 7 workflow tests (P7-8) — @temporalio/testing time-skipping env:
 * no Temporal server, no network. Activities are mocks; retry backoff is
 * fast-forwarded by the env so injected failures resolve in milliseconds.
 * Gate (TESTING.md): forced activity failure → retries → workflow completes;
 * per-river isolation; notify only on a fresh stored summary.
 */

const RIVER_IDS = ["indus-besham", "kunhar-balakot", "swat-mingora", "malir-karachi"];

function makeActivities() {
  const calls: string[] = [];
  let fetchFailures = 0;
  const alwaysFailPredict = new Set<string>();
  const state = {
    get fetchFailures() {
      return fetchFailures;
    },
    set fetchFailures(n: number) {
      fetchFailures = n;
    },
    alwaysFailPredict,
  };
  const impl: typeof activities = {
    riverById: (id) => ({ id } as never), // not called via workflow
    allRiverIds: () => RIVER_IDS, // not called via workflow
    bootGate: async () => [],
    fetchAndStoreRiver: async (riverId: string) => {
      calls.push(`fetch:${riverId}`);
      if (fetchFailures > 0) {
        fetchFailures -= 1;
        throw new Error("flood api down");
      }
      return { riverId, stored: 5 };
    },
    predictRiver: async (riverId: string) => {
      calls.push(`predict:${riverId}`);
      if (alwaysFailPredict.has(riverId)) throw new Error("predict service down");
      return { riverId, predicted: true, modelVersion: "test-v1" };
    },
    scoutCycle: async () => {
      calls.push("scout");
      return {
        rivers: [],
        queriesSpent: 0,
        cacheHits: 0,
        budget: { spent: 0, cap: 90 },
        budgetExhausted: false,
      };
    },
    summarizeCycle: async () => ({
      cycleDate: "2099-01-01",
      rivers: RIVER_IDS.map((riverId) => ({
        riverId,
        generatedBy: "model" as const,
        validated: true,
        stored: riverId === "kunhar-balakot",
        sentence: "test sentence",
        latencyMs: 10,
        promptTokens: 100,
        completionTokens: 10,
      })),
    }),
    notifyRiver: async (input: { riverId: string; summaryStored: boolean }) => {
      calls.push(`notify:${input.riverId}:${input.summaryStored}`);
      return { riverId: input.riverId, sent: input.summaryStored };
    },
  };
  return { calls, state, impl };
}

describe("weeklyCycle workflow (time-skipping env)", () => {
  let env: TestWorkflowEnvironment;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  async function runWorkflow(activityImpl: typeof activities, workflowId: string): Promise<CycleReport> {
    if (!env) {
      // The time-skipping server binary's download cache expires after a day
      // and Windows Defender then denies the fresh download (os error 5) —
      // so we pin the SDK to the copy preserved in git-ignored tools/ and
      // fall back to the SDK's own cached download elsewhere.
      const pinned = fileURLToPath(new URL("../../tools/temporal-test-server.exe", import.meta.url));
      env = await TestWorkflowEnvironment.createTimeSkipping({
        server: {
          executable: existsSync(pinned)
            ? { type: "existing-path", path: pinned }
            : { type: "cached-download" },
        },
      });
      cleanup = () => env.teardown();
    }
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("../../workers/workflows.ts", import.meta.url)),
      activities: activityImpl,
    });
    const run = worker.run();
    try {
      return await env.client.workflow.execute(weeklyCycle, {
        workflowId,
        taskQueue: TASK_QUEUE,
        args: [RIVER_IDS],
      });
    } finally {
      worker.shutdown();
      await run;
    }
  }

  it("happy path: scout → per-river fetch+predict → summarize → notify only fresh rows", { timeout: 60_000 }, async () => {
    const { calls, impl } = makeActivities();
    const report = await runWorkflow(impl, "happy");
    expect(report.scoutRan).toBe(true);
    expect(report.rivers).toHaveLength(4);
    expect(report.rivers.every((r) => r.stored === 5 && r.predicted && !r.error)).toBe(true);
    expect(report.summariesStored).toBe(1); // only kunhar's row was fresh
    expect(report.emailsSent).toEqual(["kunhar-balakot"]);
    // ordering: scout first; fetch/predict per river in order; notify last
    expect(calls[0]).toBe("scout");
    expect(calls[1]).toBe("fetch:indus-besham");
    expect(calls[2]).toBe("predict:indus-besham");
    expect(calls[9]).toBe("notify:indus-besham:false");
    expect(calls[10]).toBe("notify:kunhar-balakot:true");
  });

  it("forced activity failure retries and the workflow still completes", { timeout: 60_000 }, async () => {
    const { calls, impl, state } = makeActivities();
    state.fetchFailures = 2; // first two fetch attempts throw
    const report = await runWorkflow(impl, "retry");
    expect(report.rivers[0].error).toBeUndefined();
    expect(report.rivers[0].stored).toBe(5);
    // three attempts total for the first river (2 failures + 1 success)
    expect(calls.filter((c) => c === "fetch:indus-besham")).toHaveLength(3);
  });

  it("one river failing never blocks the others (isolation)", { timeout: 60_000 }, async () => {
    const { impl, state } = makeActivities();
    state.alwaysFailPredict.add("swat-mingora");
    const report = await runWorkflow(impl, "isolation");
    const swat = report.rivers.find((r) => r.riverId === "swat-mingora");
    expect(swat?.error).toBe("predict service down");
    expect(swat?.stored).toBe(5); // fetch succeeded before predict failed
    expect(report.rivers.find((r) => r.riverId === "kunhar-balakot")?.predicted).toBe(true);
    expect(report.emailsSent).toEqual(["kunhar-balakot"]);
  });
});
