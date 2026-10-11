"use client";

import { useState } from "react";

type Hit = {
  riverId: string;
  text: string;
  kind: string;
  url: string;
  sourceTitle: string | null;
  fetchedAt: string;
  distance: number;
};

/**
 * /about#notes-search — semantic search over the scout's collected river
 * notes (pgvector + local MiniLM). Client component because it is the one
 * genuinely interactive surface on the site; every hit still renders with
 * its source link and fetch date — provenance rules apply to search too.
 */
export default function NotesSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "search failed");
      setHits(body.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <form onSubmit={run} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the collected notes — try “Kaghan access”"
          aria-label="Search river notes"
          className="w-full rounded-lg border border-stone-edge bg-stone/60 px-3 py-2 text-sm outline-none focus:border-ochre"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg border border-stone-edge px-3 py-2 text-sm text-ochre hover:border-ochre disabled:opacity-50"
        >
          {loading ? "…" : "Search"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-status-high">{error}</p>}
      {hits && (
        <ul className="mt-3 space-y-2 text-sm">
          {hits.length === 0 && (
            <li className="text-silt-dim">No notes matched — the scout may not have found one yet.</li>
          )}
          {hits.map((h) => (
            <li key={`${h.url}-${h.text}`} className="rounded-lg border border-stone-edge bg-stone/60 p-3">
              <p>{h.text}</p>
              <p className="mt-1 font-mono text-xs text-silt-dim">
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-ochre">
                  {h.sourceTitle ?? new URL(h.url).hostname}
                </a>{" "}
                · {h.riverId} · fetched {h.fetchedAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
