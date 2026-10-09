import { NextRequest, NextResponse } from "next/server";
import { summarizeAll } from "@/lib/llm";

/**
 * POST /api/internal/summarize — one manual summary cycle (docs/API.md §2.6).
 * Token-protected with the shared X-Internal-Token secret (same pattern as
 * scout). Phase 7's worker calls summarizeAll() in-process; this route exists
 * for manual triggers until then.
 *
 * Per-river failures never abort the cycle: each river reports its own
 * generatedBy/validated/latency, and a failed river simply renders the
 * deterministic fallback in the UI (nothing is stored from a bad model).
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
    const summary = await summarizeAll();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "summarize_failed",
          message: e instanceof Error ? e.message : "summary cycle failed",
        },
      },
      { status: 500 },
    );
  }
}
