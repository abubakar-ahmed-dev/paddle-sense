// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { NextRequest } from "next/server";
import {
  searchRiver,
  runScoutCycle,
  BudgetExhaustedError,
  MONTHLY_SEARCH_CAP,
} from "@/lib/scout";
import {
  upsertSource,
  insertNoteIfMissing,
  getNotes,
  countScoutQueries,
} from "@/lib/db";
import { POST as scoutRoute } from "@/app/api/internal/scout/route";

/**
 * Phase 5 integration tests against a REAL Postgres (ephemeral Docker,
 * scripts/test-db.mjs). Fixed far-future months ("2099-xx") isolate the
 * budget ledger from anything real. No live SerpApi calls — every search
 * goes through an injected fetcher (TESTING.md §1).
 */
const url = process.env.DATABASE_TEST_URL;

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };

function organicFor(query: string) {
  if (query.includes("runnable level cfs")) {
    return {
      organic_results: [
        {
          link: "https://fixture.example/kunhar-rafting",
          title: "Kunhar rafting guide",
          snippet: "Raftable between 500 and 2,000 cfs according to local operators.",
          date: "3 days ago",
        },
      ],
    };
  }
  if (query.includes("put-in access operator")) {
    return {
      organic_results: [
        {
          link: "https://fixture.example/access",
          title: "Trip logistics",
          snippet: "Put-in near the Kalam bridge; takeout at Bahrain.",
        },
        {
          link: "https://fixture.example/history",
          title: "History",
          snippet: "The valley has a long recorded history.",
        },
      ],
    };
  }
  if (query.includes("closed")) {
    return {
      organic_results: [
        {
          link: "https://fixture.example/closure",
          title: "Update",
          snippet: "All rafting trips closed until further notice.",
        },
      ],
    };
  }
  return { organic_results: [] };
}

function makeFetcher() {
  const calls: string[] = [];
  const fetcher = async (fetchUrl: string): Promise<FakeRes> => {
    const query = decodeURIComponent(fetchUrl.match(/q=([^&]+)/)![1]);
    calls.push(query);
    return { ok: true, status: 200, json: async () => organicFor(query) };
  };
  return { calls, fetcher };
}

describe.skipIf(!url)("scout ledger + provenance (real Postgres)", () => {
  beforeAll(() => {
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
  });

  it("first search spends budget, identical query in the month is a free cache hit", async () => {
    const { calls, fetcher } = makeFetcher();
    const first = await searchRiver("kunhar rafting runnable level cfs", {
      fetcher,
      apiKey: "test",
      month: "2099-01",
    });
    expect(first.cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(first.results[0].snippet).toContain("2,000 cfs");

    const second = await searchRiver("Kunhar   RAFTING Runnable LEVEL CFS", {
      fetcher,
      apiKey: "test",
      month: "2099-01",
    });
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1); // no live call
    expect(await countScoutQueries("2099-01")).toBe(1); // still one billable row
  });

  it("budget meter hard-stops at 90 live searches/month, cache stays free", async () => {
    const sql = postgres(url!, { prepare: false });
    const spent = await countScoutQueries("2099-01");
    const filler = Array.from({ length: MONTHLY_SEARCH_CAP - 1 - spent }, (_, i) => ({
      month: "2099-01",
      query_hash: `fake-${i}`,
      query: `filler ${i}`,
      results: [],
    }));
    await sql`
      INSERT INTO scout_queries (month, query_hash, query, results)
      SELECT r.month, r.query_hash, r.query, r.results::jsonb
      FROM jsonb_to_recordset(${sql.json(filler)})
        AS r(month text, query_hash text, query text, results jsonb)`;
    expect(await countScoutQueries("2099-01")).toBe(MONTHLY_SEARCH_CAP - 1);

    const { calls, fetcher } = makeFetcher();
    const nth = await searchRiver("one before the cap", {
      fetcher,
      apiKey: "test",
      month: "2099-01",
    });
    expect(nth.cached).toBe(false);
    expect(await countScoutQueries("2099-01")).toBe(MONTHLY_SEARCH_CAP);

    await expect(
      searchRiver("one over the cap", { fetcher, apiKey: "test", month: "2099-01" }),
    ).rejects.toThrow(BudgetExhaustedError);
    expect(calls).toHaveLength(1); // refused before any network call

    // a repeat of an already-spent query stays free even at the cap
    const cached = await searchRiver("kunhar rafting runnable level cfs", {
      fetcher,
      apiKey: "test",
      month: "2099-01",
    });
    expect(cached.cached).toBe(true);
    expect(cached.results[0].snippet).toContain("2,000 cfs");
    expect(calls).toHaveLength(1);
    await sql.end();
  });

  it("a scout cycle stores sourced candidates + gated notes; Malir untouched; re-run is idempotent", async () => {
    const { fetcher } = makeFetcher();
    const first = await runScoutCycle({ fetcher, apiKey: "test", month: "2099-02" });
    expect(first.queriesSpent).toBe(9); // 3 rivers × 3 queries
    expect(first.rivers.map((r) => r.riverId)).not.toContain("malir-karachi");

    const kunhar = first.rivers.find((r) => r.riverId === "kunhar-balakot")!;
    expect(kunhar.rangeCandidates).toBe(1);
    expect(kunhar.notes).toBe(2); // access + closure; junk discarded

    // range candidate: claim text + verbatim quote (S1) + m³/s beside cfs (P5-6)
    const notes = await getNotes("kunhar-balakot");
    const candidate = notes.find((n) => n.kind === "range");
    expect(candidate?.text).toContain("500–2,000 cfs");
    expect(candidate?.text).toContain("m³/s");
    expect(candidate?.url).toBe("https://fixture.example/kunhar-rafting");

    // closure source carries the verbatim snippet as its quote
    const sql = postgres(url!, { prepare: false });
    const closure = await sql`
      SELECT s.quote FROM notes n JOIN sources s ON s.id = n.source_id
      WHERE n.river_id = 'kunhar-balakot' AND n.kind = 'closure'`;
    expect(closure[0].quote).toContain("closed until further notice");

    // second cycle: everything from cache, nothing stored twice
    const second = await runScoutCycle({ fetcher, apiKey: "test", month: "2099-02" });
    expect(second.cacheHits).toBe(9);
    expect(second.queriesSpent).toBe(0);
    expect(second.rivers.find((r) => r.riverId === "kunhar-balakot")!.notes).toBe(0);
    await sql.end();
  });

  it("invariant S1: a range source without a quote is rejected", async () => {
    await expect(
      upsertSource({ url: "https://test.example/no-quote", kind: "range", quote: null }),
    ).rejects.toThrow();
  });

  it("invariant S2: url is stored once; re-scouting keeps the original fetch", async () => {
    const a = await upsertSource({
      url: "https://test.example/s2-dup",
      kind: "access",
      quote: "put-in near the bridge",
      title: "First",
    });
    expect(a.inserted).toBe(true);
    const b = await upsertSource({
      url: "https://test.example/s2-dup",
      kind: "access",
      quote: "put-in near the bridge",
      title: "Second",
    });
    expect(b.inserted).toBe(false);
    expect(b.id).toBe(a.id);
  });

  it("notes are idempotent and FK-bound to a real source (no orphan notes)", async () => {
    const src = await upsertSource({
      url: "https://test.example/note-src",
      kind: "access",
      quote: "put-in near the bridge",
    });
    const note = {
      riverId: "swat-mingora",
      text: "Put-in near the bridge",
      kind: "access" as const,
      sourceId: src.id,
    };
    expect(await insertNoteIfMissing(note)).toBe(true);
    expect(await insertNoteIfMissing(note)).toBe(false);

    await expect(
      insertNoteIfMissing({ ...note, sourceId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow();
  });

  it("POST /api/internal/scout refuses missing or wrong tokens with the §0 error shape", async () => {
    process.env.X_INTERNAL_TOKEN = "phase5-test-token";
    try {
      const noToken = await scoutRoute(new NextRequest("http://localhost/api/internal/scout", { method: "POST" }));
      expect(noToken.status).toBe(401);
      expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe("unauthorized");

      const wrongToken = await scoutRoute(
        new NextRequest("http://localhost/api/internal/scout", {
          method: "POST",
          headers: { "x-internal-token": "nope" },
        }),
      );
      expect(wrongToken.status).toBe(401);
    } finally {
      delete process.env.X_INTERNAL_TOKEN;
    }
  });
});
