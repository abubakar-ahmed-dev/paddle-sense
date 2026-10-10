import { createHash } from "node:crypto";
import { RIVERS } from "@/lib/rivers";
import { embedText, type EmbedFn } from "@/lib/embed";
import {
  countScoutQueries,
  getScoutCache,
  insertNoteIfMissing,
  recordScoutQuery,
  upsertSource,
  type StoredSearchResult,
} from "@/lib/db";

/**
 * Scout library (Phase 5, docs/API.md §3.3, decisions P5-1…P5-9).
 *
 * - SerpApi adapter with a ledger-backed budget meter (hard stop at 90
 *   live searches/month; cache hits are free) — P5-2.
 * - Deterministic regex extraction of runnable-range candidates — P5-5 —
 *   with cfs↔m³/s conversion stored beside the verbatim quote — P5-6.
 * - Keyword relevance gates for access/closure/operator notes — P5-8;
 *   results that match nothing are discarded, never guessed.
 * - Range candidates are STORED, never auto-applied: a river's range_state
 *   flips to "verified" only via an owner-approved seed change — P5-4.
 *
 * There is no LLM in this file (Gemma arrives in Phase 6 and must never
 * decide safety-relevant ranges anyway).
 */

export const CFS_TO_CMS = 0.0283168; // 1 cubic foot per second in m³/s
export const MONTHLY_SEARCH_CAP = 90; // free plan 100 — 10 reserved (API.md §3.3)

/** Raised by the budget meter; the cycle stops cleanly, spending nothing. */
export class BudgetExhaustedError extends Error {
  constructor(month: string, cap: number) {
    super(`scout budget exhausted: ${cap} searches already spent in ${month}`);
    this.name = "BudgetExhaustedError";
  }
}

export type SerpOrganicResult = {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
};

export type SerpResponse = { organic_results?: SerpOrganicResult[] };

export type RangeCandidate = {
  lo: number | null;
  hi: number | null;
  unit: "cfs" | "m3/s";
  loM3s: number | null;
  hiM3s: number | null;
  quote: string;
  url: string;
  title: string;
};

export type NoteKind = "access" | "closure" | "operator";

export type ClassifiedNote = {
  kind: NoteKind;
  text: string;
  url: string;
  title: string;
};

// --- query identity + budget ---

/** Lowercase, whitespace-collapsed — "same question" = same hash. */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

export function queryHash(query: string): string {
  return createHash("sha256").update(normalizeQuery(query)).digest("hex");
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function defaultFetcher(url: string) {
  return fetch(url).then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() }));
}

export type SearchResult = {
  results: StoredSearchResult[];
  cached: boolean;
};

/**
 * One scout query: ledger cache → budget meter → live SerpApi → ledger.
 * Cache hits never touch the network and never count toward the cap (P5-2).
 * The API key is never included in error messages.
 */
export async function searchRiver(
  query: string,
  opts: { fetcher?: Fetcher; month?: string; apiKey?: string } = {},
): Promise<SearchResult> {
  const month = opts.month ?? currentMonth();
  const hash = queryHash(query);

  const cached = await getScoutCache(month, hash);
  if (cached) return { results: cached, cached: true };

  const spent = await countScoutQueries(month);
  if (spent >= MONTHLY_SEARCH_CAP) throw new BudgetExhaustedError(month, MONTHLY_SEARCH_CAP);

  const apiKey = opts.apiKey ?? process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY is not set");

  const fetcher = opts.fetcher ?? defaultFetcher;
  const url =
    `https://serpapi.com/search?engine=google&num=10` +
    `&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`SerpApi search failed with status ${res.status}`);

  const body = (await res.json()) as SerpResponse;
  const results: StoredSearchResult[] = (body.organic_results ?? []).flatMap((r) =>
    r.link && r.snippet
      ? [
          {
            link: r.link,
            title: r.title ?? "",
            snippet: r.snippet,
            date: typeof r.date === "string" ? r.date : null,
          },
        ]
      : [],
  );

  await recordScoutQuery(month, hash, query, results);
  return { results, cached: false };
}

// --- extraction (P5-5) + conversion (P5-6) ---

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const UNIT = String.raw`(c\.?f\.?s\.?|cms|cumecs|m³/s|m3/s)`;
const SEP = String.raw`(?:\s*(?:–|—|-|to)\s*)`;

function normalizeUnit(raw: string): "cfs" | "m3/s" {
  const u = raw.toLowerCase().replace(/\./g, "");
  return u === "cfs" ? "cfs" : "m3/s";
}

function parseNumber(raw: string): number | null {
  const v = Number(raw.replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function toM3s(value: number, unit: "cfs" | "m3/s"): number {
  return unit === "cfs" ? value * CFS_TO_CMS : value;
}

function candidate(
  lo: number | null,
  hi: number | null,
  unit: "cfs" | "m3/s",
  quote: string,
  url: string,
  title: string,
): RangeCandidate {
  return {
    lo,
    hi,
    unit,
    loM3s: lo === null ? null : toM3s(lo, unit),
    hiM3s: hi === null ? null : toM3s(hi, unit),
    quote,
    url,
    title,
  };
}

/**
 * Deterministic range extraction over a snippet. Forms recognized:
 *   "between 500 and 2,000 cfs" · "between 500 cfs and 2,000 cfs" ·
 *   "150–400 cfs" · "500 to 2000 m³/s" · "minimum 300 cfs" / "at least 300 cfs"
 * A range WITHOUT a unit near the numbers is discarded — no unit, no guess.
 */
export function extractRangeCandidates(
  snippet: string,
  source: { url: string; title: string },
): RangeCandidate[] {
  const found: RangeCandidate[] = [];
  const push = (lo: number | null, hi: number | null, unit: "cfs" | "m3/s") => {
    if (lo === null) return;
    if (hi !== null && hi <= lo) return; // R2 invariant would never hold
    if (found.some((c) => c.lo === lo && c.hi === hi && c.unit === unit)) return;
    found.push(candidate(lo, hi, unit, snippet, source.url, source.title));
  };

  // "between X [unit] and/to Y [unit]"
  const between = new RegExp(
    String.raw`\bbetween\s+${NUM}\s*${UNIT}?\s*(?:and|to)\s+${NUM}\s*${UNIT}?`,
    "gi",
  );
  for (const m of snippet.matchAll(between)) {
    const lo = parseNumber(m[1]);
    const hi = parseNumber(m[3]);
    const unitRaw = m[2] ?? m[4];
    if (!unitRaw) continue; // no unit anywhere → discard, don't guess
    push(lo, hi, normalizeUnit(unitRaw));
  }

  // "X–Y unit" / "X to Y unit"
  const span = new RegExp(String.raw`\b${NUM}${SEP}${NUM}\s*${UNIT}\b`, "gi");
  for (const m of snippet.matchAll(span)) {
    push(parseNumber(m[1]), parseNumber(m[2]), normalizeUnit(m[3]));
  }

  // minimum-only forms → lo candidate, hi unknown
  const minimum = new RegExp(
    String.raw`\b(?:minimum(?:\s+of)?|min\.?|at\s+least|no\s+less\s+than|above)\s+${NUM}\s*${UNIT}\b`,
    "gi",
  );
  for (const m of snippet.matchAll(minimum)) {
    push(parseNumber(m[1]), null, normalizeUnit(m[2]));
  }

  return found;
}

/** m³/s shown beside the raw claim (P5-6): compact, honest rounding. */
export function fmtM3s(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function formatRangeText(c: RangeCandidate): string {
  const toM3sLabel = (v: number | null) => (v === null ? null : `${fmtM3s(v)} m³/s`);
  if (c.lo !== null && c.hi !== null) {
    return `Published range candidate: ${c.lo.toLocaleString("en-US")}–${c.hi.toLocaleString("en-US")} ${c.unit} (≈${toM3sLabel(c.loM3s)}–${toM3sLabel(c.hiM3s)})`;
  }
  return `Published minimum-flow candidate: ${c.lo?.toLocaleString("en-US")} ${c.unit} (≈${toM3sLabel(c.loM3s)})`;
}

// --- relevance gates (P5-8): a result must be about THIS river before any
// kind gate applies; results that match nothing are discarded, not guessed ---

const STRETCH_STOPLIST = new Set(["river", "stretch", "the", "of", "lower", "upper"]);

/** Proper-noun tokens that tie a page to this river (name + stretch names). */
export function riverTokens(river: { name: string; stretch: string }): string[] {
  return [river.name, ...river.stretch.split(/[\s,()]+/)]
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !STRETCH_STOPLIST.has(t));
}

export function riverRelevant(
  text: string,
  river: { name: string; stretch: string },
): boolean {
  const haystack = text.toLowerCase();
  return riverTokens(river).some((t) => haystack.includes(t));
}


// Per-kind gates: first match wins, no match = discarded
const NOTE_GATES: [NoteKind, RegExp][] = [
  ["closure", /\b(closed|closure|ban(?:ned)?|flood damage|suspended|no (?:rafting|boating))\b/i],
  ["access", /\b(put[- ]?in|take[- ]?out|access(?:ible)?|bridge|road|launch(?:site|ing)?|ramp)\b/i],
  ["operator", /\b(rafting|kayak(?:ing)?|tour(?:ism)?|operator|outfitter|adventure|expedition)\b/i],
];

export function classifyNote(
  result: { link?: string; title?: string; snippet?: string },
): ClassifiedNote | null {
  if (!result.link || !result.snippet) return null;
  const haystack = `${result.title ?? ""} ${result.snippet}`;
  for (const [kind, gate] of NOTE_GATES) {
    if (gate.test(haystack)) {
      const title = (result.title ?? "").trim();
      const text = `${title ? `${title} — ` : ""}${result.snippet}`.trim();
      return { kind, text, url: result.link, title: result.title ?? "" };
    }
  }
  return null;
}

// --- cycle (P5-1): one scout pass over the scouted rivers ---

export type QueryKind = "range" | "access" | "closure";

/** Query templates verbatim from docs/API.md §3.3. */
export function queryTemplates(river: { name: string; stretch: string }, now = new Date()) {
  const month = now.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const year = now.getUTCFullYear();
  const queries: [QueryKind, string][] = [
    ["range", `${river.name} ${river.stretch} rafting runnable level cfs`],
    ["access", `${river.name} ${river.stretch} put-in access operator`],
    ["closure", `${river.name} rafting closed ${month} ${year}`],
  ];
  return queries;
}

export type RiverCycleSummary = {
  riverId: string;
  queries: number;
  cacheHits: number;
  rangeCandidates: number;
  notes: number;
  errors: string[];
};

export type ScoutCycleSummary = {
  rivers: RiverCycleSummary[];
  queriesSpent: number;
  cacheHits: number;
  budget: { spent: number; cap: number };
  budgetExhausted: boolean;
};

/** Malir is never scouted — its state is config, not something search can prove. */
export function scoutedRivers() {
  return RIVERS.filter((r) => r.rangeState !== "not_a_paddling_river");
}

/**
 * One scout cycle: per river, the three template queries; every result is
 * either extracted (range candidates) or keyword-gated (notes) or discarded.
 * Extraction re-runs on cached results too (P5-3) — improvements in the
 * patterns cost zero budget. Sources are deduped by url (S2); notes are
 * idempotent; nothing here changes a river's range_state (P5-4).
 */
/**
 * Embed-or-skip: a note with no embedding is still stored (the HNSW index
 * simply skips it) — an embedding outage must never drop provenance (P75-3).
 */
async function safeEmbed(text: string, embed: EmbedFn): Promise<number[] | undefined> {
  try {
    return await embed(text);
  } catch {
    return undefined;
  }
}

export async function runScoutCycle(opts: {
  fetcher?: Fetcher;
  apiKey?: string;
  month?: string;
  now?: Date;
  /** Note embedder (Phase 7b); default = local MiniLM. Failure never fails the cycle. */
  embed?: EmbedFn;
} = {}): Promise<ScoutCycleSummary> {
  const month = opts.month ?? currentMonth(opts.now);
  const summary: ScoutCycleSummary = {
    rivers: [],
    queriesSpent: 0,
    cacheHits: 0,
    budget: { spent: 0, cap: MONTHLY_SEARCH_CAP },
    budgetExhausted: false,
  };

  for (const river of scoutedRivers()) {
    const perRiver: RiverCycleSummary = {
      riverId: river.id,
      queries: 0,
      cacheHits: 0,
      rangeCandidates: 0,
      notes: 0,
      errors: [],
    };

    for (const [kind, query] of queryTemplates(river, opts.now)) {
      if (summary.budgetExhausted) break;
      let result: SearchResult;
      try {
        result = await searchRiver(query, opts);
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          summary.budgetExhausted = true;
          break;
        }
        perRiver.errors.push(`${kind}: ${e instanceof Error ? e.message : "search failed"}`);
        continue;
      }
      perRiver.queries += 1;
      if (result.cached) perRiver.cacheHits += 1;

      for (const r of result.results) {
        const organic = { link: r.link, title: r.title, snippet: r.snippet };
        // A result must first be about THIS river — US guidebook ranges
        // matching the query template say nothing about the Indus (P5-8).
        if (!riverRelevant(`${r.title} ${r.snippet}`, river)) continue;
        if (kind === "range") {
          for (const c of extractRangeCandidates(r.snippet, { url: r.link, title: r.title })) {
            const src = await upsertSource({
              url: c.url,
              kind: "range",
              quote: c.quote, // verbatim — invariant S1
              title: c.title || null,
              searchQuery: query,
            });
            const stored = await insertNoteIfMissing({
              riverId: river.id,
              text: formatRangeText(c),
              kind: "range",
              sourceId: src.id,
              embedding: await safeEmbed(formatRangeText(c), opts.embed ?? embedText),
            });
            if (stored) perRiver.rangeCandidates += 1;
          }
        } else {
          const note = classifyNote(organic);
          if (!note) continue; // discarded, not guessed (P5-8)
          const src = await upsertSource({
            url: note.url,
            kind: note.kind,
            quote: note.text, // verbatim snippet text
            title: note.title || null,
            searchQuery: query,
          });
          const stored = await insertNoteIfMissing({
            riverId: river.id,
            text: note.text,
            kind: note.kind,
            sourceId: src.id,
            embedding: await safeEmbed(note.text, opts.embed ?? embedText),
          });
          if (stored) perRiver.notes += 1;
        }
      }
    }

    summary.rivers.push(perRiver);
    summary.queriesSpent += perRiver.queries - perRiver.cacheHits;
    summary.cacheHits += perRiver.cacheHits;
  }

  summary.budget.spent = await countScoutQueries(month);
  return summary;
}
