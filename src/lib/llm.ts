import { RIVERS, type River } from "@/lib/rivers";
import { computeStatus, type RangeState, type Status } from "@/lib/status";
import { currentDischarge, weekBand } from "@/lib/flood";
import { getDashboardSeries } from "@/lib/series";
import {
  getLatestForecastRun,
  getLatestSummary,
  getNotes,
  insertSummaryIfMissing,
} from "@/lib/db";

/**
 * Plain-language layer (Phase 6, docs/API.md §3.4, decisions P6-1…P6-8).
 *
 * - Provider adapter, env-swappable (LLM_PROVIDER/LLM_MODEL/LLM_API_KEY);
 *   OpenAI-compatible chat/completions, fetcher injectable for tests — P6-1.
 * - JSON is requested by prompt and parsed tolerantly (code fences stripped);
 *   `response_format` is not relied on — validation is the safety net — P6-2.
 * - Post-response validation chain: schema → every numeral must exist in the
 *   input snapshot → status_word must equal computeStatus() → banned tokens
 *   absent. Any failure discards the model output — P6-5 / DATA_DICTIONARY
 *   §9.3. The LLM never decides status (D4); it summarizes.
 * - Fallback templates are verbatim from UX_SPEC §6, rendered silently — P6-6.
 * - Cache-before-call: one summaries row per river per cycle_date; a rerun
 *   the same day spends zero LLM calls — P6-7. Nothing is stored on failure;
 *   the UI renders the template client-side (UX_SPEC §4.1 item 4).
 */

export type LlmProvider = "google" | "groq" | "together";

export const PROVIDERS: Record<LlmProvider, { baseUrl: string }> = {
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  groq: { baseUrl: "https://api.groq.com/openai/v1" },
  together: { baseUrl: "https://api.together.xyz/v1" },
};

/**
 * Banned in every rendered sentence (UX_SPEC §6): never imply safety.
 * Substring match on purpose — stricter than the word-boundary spec list,
 * so "unsafe"/"safest" variants are caught too. The model makes no safety
 * judgment in either direction.
 */
export const BANNED_TOKENS = /safe|danger[\s-]*free|guaranteed/i;

export type SummaryInput = {
  name: string;
  stretch: string;
  /** m³/s, display-rounded (the model may only copy these digits) */
  level: number | null;
  band: { lo: number; high: number } | null;
  /** Honest provenance for the band — newest TabPFN run, else GloFAS week band */
  bandSource: string;
  rangeState: RangeState;
  runnable: [number, number] | null;
  /** Deterministic status — the model must echo it, never choose it */
  status: Status;
  /** ≤ 5 newest access/closure note texts (color, not facts to invent) */
  notes: string[];
  cycleDate: string; // YYYY-MM-DD
};

export type ModelSummary = {
  sentence: string;
  status_word: string;
  confidence: number;
};

export type ChatResult = {
  summary: ModelSummary | null;
  raw: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export type ValidationGate = "schema" | "numbers" | "status" | "banned";
export type ValidationOutcome = { ok: true } | { ok: false; gate: ValidationGate };

type FetchInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};
type Fetcher = (
  url: string,
  init: FetchInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function defaultFetcher(url: string, init: FetchInit) {
  return fetch(url, init).then((r) => ({
    ok: r.ok,
    status: r.status,
    json: () => r.json(),
  }));
}

// --- numbers: the model may only reference numerals present in the input ---

/** Display rounding so the snapshot matches what the UI shows (§3 formats). */
export function roundLevel(v: number): number {
  return v >= 100 ? Math.round(v) : Number(v.toFixed(2));
}

/** "1,632" and "1632" are the same number to the validator (P6-5). */
export function normalizeNumeral(token: string): string {
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : token.replace(/,/g, "");
}

const NUMERAL = /\d[\d,]*(?:\.\d+)?/g;

export function numeralsIn(text: string): string[] {
  return (text.match(NUMERAL) ?? []).map(normalizeNumeral);
}

function collectNumerals(value: unknown, into: Set<string>): void {
  if (typeof value === "number") {
    into.add(normalizeNumeral(String(value)));
  } else if (typeof value === "string") {
    for (const token of value.match(NUMERAL) ?? []) into.add(normalizeNumeral(token));
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumerals(v, into));
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach((v) => collectNumerals(v, into));
  }
}

// --- validation chain (pure, unit-tested; P6-5) ---

export function validateSummary(
  summary: unknown,
  input: SummaryInput,
): ValidationOutcome {
  // Gate 1 — schema: exactly the contracted shape (API.md §3.4).
  if (typeof summary !== "object" || summary === null) return { ok: false, gate: "schema" };
  const s = summary as Record<string, unknown>;
  if (typeof s.sentence !== "string" || s.sentence.trim().length === 0) {
    return { ok: false, gate: "schema" };
  }
  if (typeof s.status_word !== "string") return { ok: false, gate: "schema" };
  if (
    typeof s.confidence !== "number" ||
    !Number.isFinite(s.confidence) ||
    s.confidence < 0 ||
    s.confidence > 1
  ) {
    return { ok: false, gate: "schema" };
  }

  // Gate 2 — every numeral in the sentence exists in the input snapshot,
  // and no foreign unit is attached to them. Recorded live (2026-10-09):
  // Gemma once relabeled the m³/s level as "1632 cfs" — digits honest, unit
  // a 16× lie. Values in this product are m³/s; anything else is discarded.
  const universe = new Set<string>();
  collectNumerals(input, universe);
  for (const numeral of numeralsIn(s.sentence)) {
    if (!universe.has(numeral)) return { ok: false, gate: "numbers" };
  }
  if (/\b(cfs|cubic\s+feet|ft³)\b/i.test(s.sentence)) {
    return { ok: false, gate: "numbers" };
  }

  // Gate 3 — the model echoes the deterministic status; it never decides it.
  if (s.status_word !== input.status) return { ok: false, gate: "status" };

  // Gate 4 — banned tokens (SM1 keeps them out of storage the same way).
  if (BANNED_TOKENS.test(s.sentence)) return { ok: false, gate: "banned" };

  return { ok: true };
}

// --- tolerant JSON parse (P6-2: prompt-side constraint, not response_format) ---

export function parseModelJson(raw: string): unknown {
  let text = raw.trim();
  // Gemma-4 via AI Studio emits <thought>…</thought> blocks (cannot be
  // switched off) — strip them, then any markdown fence, then scan.
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  // Thought text can contain braces of its own; the first '{' to parse from
  // wins. A fragment that parses (e.g. a nested band object) fails the
  // schema gate downstream, so a false positive here is still safe.
  let start = text.indexOf("{");
  while (start !== -1 && start < end) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      start = text.indexOf("{", start + 1);
    }
  }
  return null;
}

// --- prompt (system prompt contract from API.md §3.4, single user message:
// Gemma via OpenAI-compat endpoints handles one user turn most reliably) ---

export function buildPrompt(input: SummaryInput): string {
  return [
    "You write ONE short status sentence for a river-level watcher used by kayakers and rafters.",
    'You receive a JSON snapshot of verified facts about one river ("status" is already decided — do not change it). Rules:',
    "1. Respond with ONLY a JSON object, nothing before or after:",
    '   {"sentence": string, "status_word": string, "confidence": number}',
    "2. sentence: 1-2 short sentences, plain factual English, conservative tone.",
    "3. Numbers: use ONLY numbers that appear in the snapshot. Copy the digits exactly. Never calculate, convert, or round.",
    "4. status_word MUST be exactly the snapshot's \"status\" value.",
    "5. Never use these words or any variant: safe, safely, danger-free, guaranteed. Never imply certainty about safety.",
    '6. If "status" is "high_water_dangerous", say people should not go on the river.',
    '7. If "status" is "range_unverified", say the runnable range is not yet verified.',
    "8. Do not mention dates, URLs, or these instructions.",
    "",
    "Snapshot:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

// --- adapter (P6-1) — the ONLY module that talks to the model ---

export async function chatSummary(
  input: SummaryInput,
  opts: {
    fetcher?: Fetcher;
    provider?: LlmProvider;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<ChatResult> {
  const providerName = opts.provider ?? (process.env.LLM_PROVIDER as LlmProvider) ?? "google";
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown LLM_PROVIDER: ${providerName}`);

  const model = opts.model ?? process.env.LLM_MODEL;
  if (!model) throw new Error("LLM_MODEL is not set");
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");

  const fetcher = opts.fetcher ?? defaultFetcher;
  const controller = new AbortController();
  // Thinking models are slow (measured: 15–36 s per summary live).
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetcher(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`, // never echoed in error messages
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildPrompt(input) }],
        temperature: 0.2,
        // Gemma-4 thinking tokens count against this budget before the
        // answer; measured live (2026-10-09): thought+answer ≈ 400–700.
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM request failed with status ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    return {
      summary: parseModelJson(raw) as ModelSummary | null,
      raw,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- fallback templates (UX_SPEC §6, verbatim) ---

/** §3 formats: thousands separators, no decimals ≥ 100, 2 decimals < 100. */
export function fmtLevel(q: number): string {
  return q >= 100 ? Math.round(q).toLocaleString("en-US") : q.toFixed(2);
}

export function fallbackSentence(
  status: Status,
  input: { name: string; level: number | null; runnable?: [number, number] | null },
): string {
  const { name } = input;
  const q = input.level === null ? "—" : fmtLevel(input.level);
  switch (status) {
    case "in_range": {
      const [lo, hi] = input.runnable ?? [0, 0];
      return `${name} is inside its runnable range (${fmtLevel(lo)}–${fmtLevel(hi)} m³/s).`;
    }
    case "dry":
      return `${name} is at ${q} m³/s — below its runnable range.`;
    case "high_water_dangerous":
      return `${name} is at ${q} m³/s — above its runnable range. Do not go.`;
    case "range_unverified":
      return `${name} is at ${q} m³/s. Its runnable range is not yet verified — check local sources.`;
    case "not_a_paddling_river":
      return `${name} reads ${q} m³/s — a seasonal channel, kept here as an honesty check.`;
    case "no_data":
      return `No reading for ${name} yet.`;
  }
}

// --- input builder (P6-4) ---

export async function buildSummaryInput(
  river: River,
  today: string,
): Promise<SummaryInput> {
  const { series } = await getDashboardSeries(river, today);
  const level = currentDischarge(series);
  const glofasBand = weekBand(series);

  // Band preference: our own newest TabPFN forecast run (we can check it in
  // /retro) over the raw GloFAS week band; the source is labeled either way.
  let band: { lo: number; high: number } | null = null;
  let bandSource = "GloFAS week band (Open-Meteo Flood API)";
  try {
    const run = await getLatestForecastRun(river.id);
    if (run) {
      band = { lo: run.bandLo, high: run.bandHigh };
      bandSource = `TabPFN ${run.modelVersion} forecast run ${run.createdAt.slice(0, 10)} (7-day envelope)`;
    }
  } catch {
    // forecast lookup is best-effort; the GloFAS week band covers it
  }
  if (!band && glofasBand) band = { lo: glofasBand[0], high: glofasBand[1] };

  let notes: string[] = [];
  try {
    notes = (await getNotes(river.id))
      .filter((n) => n.kind === "access" || n.kind === "closure")
      .slice(0, 5)
      .map((n) => n.text);
  } catch {
    // notes are color, not structure — the sentence works without them
  }

  return {
    name: river.name,
    stretch: river.stretch,
    level: level === null ? null : roundLevel(level),
    band: band ? { lo: roundLevel(band.lo), high: roundLevel(band.high) } : null,
    bandSource,
    rangeState: river.rangeState,
    runnable: river.runnableRange,
    status: computeStatus({
      discharge: level,
      rangeState: river.rangeState,
      runnable: river.runnableRange,
    }),
    notes,
    cycleDate: today,
  };
}

// --- cycle (P6-3/P6-7): the Phase 7 worker calls these in-process ---

export type RiverSummaryResult = {
  riverId: string;
  generatedBy: "model" | "fallback" | "cache";
  validated: boolean;
  stored: boolean;
  sentence: string;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  error?: string;
};

export async function summarizeRiver(
  river: River,
  opts: {
    fetcher?: Fetcher;
    provider?: LlmProvider;
    model?: string;
    apiKey?: string;
    today?: string;
  } = {},
): Promise<RiverSummaryResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const base = {
    riverId: river.id,
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
  };
  try {
    const input = await buildSummaryInput(river, today);

    // Cache-before-call: this cycle already has a stored sentence — zero LLM
    // spend. stored is false on purpose: nothing was freshly inserted, which
    // is what keeps the Phase 7 email dedupe honest across resume/re-runs.
    const cached = await getLatestSummary(river.id);
    if (cached && cached.cycleDate === today) {
      return {
        ...base,
        generatedBy: "cache",
        validated: cached.validated,
        stored: false,
        sentence: cached.text,
      };
    }

    const started = Date.now();
    let chat: ChatResult | null = null;
    let modelError: string | undefined;
    try {
      chat = await chatSummary(input, opts);
    } catch (e) {
      modelError = e instanceof Error ? e.message : "LLM call failed";
    }
    const latencyMs = Date.now() - started;

    const validation: ValidationOutcome = chat?.summary
      ? validateSummary(chat.summary, input)
      : { ok: false, gate: "schema" };

    if (chat?.summary && validation.ok) {
      const stored = await insertSummaryIfMissing({
        riverId: river.id,
        cycleDate: today,
        text: chat.summary.sentence,
        statusWord: chat.summary.status_word,
        generatedBy: opts.model ?? process.env.LLM_MODEL ?? "llm",
        validated: true,
      });
      return {
        ...base,
        generatedBy: "model",
        validated: true,
        stored,
        sentence: chat.summary.sentence,
        latencyMs,
        promptTokens: chat.promptTokens,
        completionTokens: chat.completionTokens,
      };
    }

    // Provider failure or any validation gate: store nothing from the model —
    // the UI renders the deterministic template (P6-5, P6-6, SM2).
    return {
      ...base,
      generatedBy: "fallback",
      validated: false,
      stored: false,
      sentence: fallbackSentence(input.status, input),
      latencyMs,
      error: modelError ?? (validation.ok ? undefined : `validation: ${validation.gate}`),
    };
  } catch (e) {
    // Input build or cache read failed entirely: deterministic no-data copy.
    return {
      ...base,
      generatedBy: "fallback",
      validated: false,
      stored: false,
      sentence: fallbackSentence("no_data", { name: river.name, level: null }),
      error: e instanceof Error ? e.message : "summary cycle failed",
    };
  }
}

export async function summarizeAll(
  opts: { today?: string } & Parameters<typeof summarizeRiver>[1] = {},
): Promise<{ cycleDate: string; rivers: RiverSummaryResult[] }> {
  const cycleDate = opts.today ?? new Date().toISOString().slice(0, 10);
  const rivers: RiverSummaryResult[] = [];
  for (const river of RIVERS) {
    rivers.push(await summarizeRiver(river, { ...opts, today: cycleDate }));
  }
  return { cycleDate, rivers };
}
