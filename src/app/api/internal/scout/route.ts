import { NextRequest, NextResponse } from "next/server";
import { runScoutCycle } from "@/lib/scout";

/**
 * POST /api/internal/scout — one manual scout cycle (docs/API.md §2.5).
 * Token-protected with the shared X-Internal-Token secret (same pattern as
 * the predict service). Phase 7's worker calls runScoutCycle() in-process;
 * this route exists for manual triggers until then.
 *
 * Budget exhaustion stops the cycle cleanly — the summary reports what ran
 * and what was already spent; other per-query errors are recorded per river
 * and never abort the whole pass.
 */

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-internal-token");
  const expected = process.env.X_INTERNAL_TOKEN;
  if (!expected || !token || token !== expected) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "missing or invalid X-Internal-Token" } },
      { status: 401 },
    );
  }

  try {
    const summary = await runScoutCycle();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "scout_failed",
          message: e instanceof Error ? e.message : "scout cycle failed",
        },
      },
      { status: 500 },
    );
  }
}
