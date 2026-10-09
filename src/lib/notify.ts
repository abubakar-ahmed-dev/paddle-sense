/**
 * Range-entry notification (Phase 7, FR-9; ARCH §3.7).
 *
 * - `shouldNotify` is a pure transition check: only a *move into* `in_range`
 *   emails. A river already in range, or a first cycle with unknown history,
 *   stays silent — no crossing observed, no claim made.
 * - The email body is the DETERMINISTIC status sentence + band + source
 *   links — never the LLM sentence alone (ARCH §3.7).
 * - Resend REST API via injectable fetcher; the key lives only in the
 *   Authorization header and never appears in errors or logs.
 * - Notify failures must never fail the cycle: the activity retries, then
 *   skips — a missed nudge is logged, a broken cycle is worse.
 */

export type NotifyInput = {
  riverId: string;
  name: string;
  /** m³/s, display-rounded */
  level: number | null;
  band: { lo: number; high: number } | null;
  bandSource: string;
  /** Deterministic status sentence (UX_SPEC §6 template) */
  sentence: string;
};

/** True only when the river moved INTO its runnable range this cycle. */
export function shouldNotify(
  previousStatusWord: string | null,
  currentStatusWord: string,
): boolean {
  return (
    previousStatusWord !== null &&
    previousStatusWord !== "in_range" &&
    currentStatusWord === "in_range"
  );
}

export function buildRangeEmail(input: NotifyInput): {
  subject: string;
  text: string;
} {
  const level =
    input.level === null
      ? "—"
      : input.level >= 100
        ? input.level.toLocaleString("en-US")
        : input.level.toFixed(2);
  const band = input.band
    ? `${input.band.lo.toLocaleString("en-US")}–${input.band.high.toLocaleString("en-US")} m³/s`
    : "not available this cycle";
  const base = process.env.APP_BASE_URL ?? "";
  const subject = `${input.name} is in its runnable range`;
  const text = [
    `${input.name} entered its runnable range.`,
    "",
    input.sentence,
    "",
    `Current level: ${level} m³/s`,
    `Next-week band: ${band} (${input.bandSource})`,
    "",
    `River page: ${base}/river/${input.riverId}`,
    "Method & honesty notes: see /about — status is computed from stored data,",
    "ranges are verified by a human from quoted sources; this email never",
    "contains model-generated text.",
  ].join("\n");
  return { subject, text };
}

export type NotifyFetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function defaultFetcher(
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) {
  return fetch(url, init).then((r) => ({
    ok: r.ok,
    status: r.status,
    json: () => r.json(),
  }));
}

export async function sendRangeEmail(
  input: NotifyInput,
  opts: { fetcher?: NotifyFetcher; apiKey?: string; to?: string } = {},
): Promise<{ sent: boolean; id?: string; skipped?: string }> {
  const provider = process.env.NOTIFY_EMAIL_PROVIDER ?? "resend";
  if (provider !== "resend") {
    // Gmail SMTP (nodemailer) is the documented fallback — not built in v1.
    return { sent: false, skipped: `provider ${provider} not supported` };
  }
  const apiKey = opts.apiKey ?? process.env.NOTIFY_EMAIL_KEY;
  const to = opts.to ?? process.env.NOTIFY_EMAIL_TO;
  if (!apiKey || !to) return { sent: false, skipped: "NOTIFY_EMAIL_KEY/TO not set" };

  const fetcher = opts.fetcher ?? defaultFetcher;
  const { subject, text } = buildRangeEmail(input);
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`, // never echoed in error messages
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM ?? "PaddleSense <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend request failed with status ${res.status}`);
  const body = (await res.json()) as { id?: string };
  return { sent: true, id: body.id };
}
