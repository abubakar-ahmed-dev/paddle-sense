// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { insertNoteIfMissing, searchNotes, upsertSource } from "@/lib/db";

/**
 * pgvector semantic search (Phase 7b, P75-3) against real Postgres.
 * Vectors are literals — the MiniLM model never runs in CI (TESTING §1).
 */
const url = process.env.DATABASE_TEST_URL;

const VEC = (seed: number) =>
  Array.from({ length: 384 }, (_, i) => (((i + seed) % 13) + 1) / 200);

describe.skipIf(!url)("note embeddings + semantic search (real Postgres)", () => {
  let sourceId: string;

  beforeAll(async () => {
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
    sourceId = (await upsertSource({
      url: "https://fixture.example/search-note",
      kind: "access",
      quote: "Put-in near the Kaghan bridge; operators run in summer.",
      title: "fixture",
    })).id;
    await insertNoteIfMissing({
      riverId: "kunhar-balakot",
      text: "fixture embedded note (near vector)",
      kind: "access",
      sourceId,
      embedding: VEC(0),
    });
    await insertNoteIfMissing({
      riverId: "swat-mingora",
      text: "fixture plain note (no embedding)",
      kind: "access",
      sourceId,
    });
  });

  afterAll(async () => {
    const sql = postgres(url!, { connect_timeout: 15, max: 1 });
    try {
      await sql`DELETE FROM notes WHERE "text" LIKE 'fixture %'`;
      await sql`DELETE FROM sources WHERE url = 'https://fixture.example/search-note'`;
    } finally {
      await sql.end();
    }
  });

  it("stores the embedding and ranks the near vector first", async () => {
    const hits = await searchNotes(VEC(0), 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].text).toBe("fixture embedded note (near vector)");
    expect(hits[0].riverId).toBe("kunhar-balakot");
    expect(hits[0].url).toBe("https://fixture.example/search-note");
    expect(hits[0].distance).toBeCloseTo(0, 5); // identical vector ⇒ distance 0
  });

  it("excludes notes without embeddings", async () => {
    const texts = (await searchNotes(VEC(3), 50)).map((h) => h.text);
    expect(texts).not.toContain("fixture plain note (no embedding)");
  });

  it("returns hits with source provenance (url + fetched date)", async () => {
    const hit = (await searchNotes(VEC(0), 1))[0];
    expect(hit.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}[T ]/);
  });
});
