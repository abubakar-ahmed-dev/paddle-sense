import { NextRequest, NextResponse } from "next/server";
import { searchNotes } from "@/lib/db";
import { embedText } from "@/lib/embed";

/**
 * GET /api/v1/search?q=… — semantic search over scouted river notes
 * (Phase 7b, P75-3). The query is embedded with the same local MiniLM the
 * notes were embedded with; cosine top-5 via the HNSW index. Read-only,
 * no key, no PII — every hit carries its source link and fetch date.
 *
 * Errors: 400 missing q · 502 embedding model failure (honest, not silent).
 */

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: { code: "missing_query", message: "pass ?q=<text>" } },
      { status: 400 },
    );
  }
  try {
    const vector = await embedText(q);
    const hits = await searchNotes(vector, 5);
    return NextResponse.json({ query: q, hits });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "search_failed",
          message: e instanceof Error ? e.message : "search failed",
        },
      },
      { status: 502 },
    );
  }
}
