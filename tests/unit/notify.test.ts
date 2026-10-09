import { describe, it, expect, afterEach } from "vitest";
import {
  buildRangeEmail,
  sendRangeEmail,
  shouldNotify,
  type NotifyInput,
} from "@/lib/notify";

/** FR-9 / ARCH §3.7: transition-into-range only; deterministic email body. */

const input: NotifyInput = {
  riverId: "kunhar-balakot",
  name: "Kunhar",
  level: 95,
  band: { lo: 40, high: 120 },
  bandSource: "TabPFN tabpfn-v1 forecast run 2026-10-09 (7-day envelope)",
  sentence: "Kunhar is inside its runnable range (40–120 m³/s).",
};

describe("shouldNotify transition truth table", () => {
  it("notifies on a move into in_range", () => {
    expect(shouldNotify("dry", "in_range")).toBe(true);
    expect(shouldNotify("high_water_dangerous", "in_range")).toBe(true);
    expect(shouldNotify("range_unverified", "in_range")).toBe(true);
  });

  it("stays silent otherwise", () => {
    expect(shouldNotify("in_range", "in_range")).toBe(false);
    expect(shouldNotify("dry", "dry")).toBe(false);
    expect(shouldNotify("dry", "high_water_dangerous")).toBe(false);
    expect(shouldNotify("range_unverified", "dry")).toBe(false);
  });

  it("first cycle (unknown history) never claims a crossing", () => {
    expect(shouldNotify(null, "in_range")).toBe(false);
  });
});

describe("buildRangeEmail", () => {
  it("carries the deterministic sentence, band with source, and links", () => {
    const { subject, text } = buildRangeEmail(input);
    expect(subject).toBe("Kunhar is in its runnable range");
    expect(text).toContain("Kunhar is inside its runnable range (40–120 m³/s).");
    expect(text).toContain("95.00 m³/s");
    expect(text).toContain("40–120 m³/s");
    expect(text).toContain(input.bandSource);
    expect(text).toContain("/river/kunhar-balakot");
    expect(text).toContain("never");
  });

  it("handles a missing level and band honestly", () => {
    const { text } = buildRangeEmail({ ...input, level: null, band: null });
    expect(text).toContain("Current level: — m³/s");
    expect(text).toContain("not available this cycle");
  });
});

describe("sendRangeEmail adapter (fixture fetcher, no live calls)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("posts to Resend with the key in the header only, returns the id", async () => {
    process.env.NOTIFY_EMAIL_PROVIDER = "resend";
    const calls: { url: string; body: string; auth: string | undefined }[] = [];
    const fetcher = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization });
      return { ok: true, status: 200, json: async () => ({ id: "email-123" }) };
    };
    const res = await sendRangeEmail(input, { fetcher, apiKey: "test-key", to: "owner@example.com" });
    expect(res).toEqual({ sent: true, id: "email-123" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].auth).toBe("Bearer test-key");
    const body = JSON.parse(calls[0].body);
    expect(body.to).toBe("owner@example.com");
    expect(body.subject).toContain("Kunhar");
    expect(body.from).toContain("PaddleSense");
  });

  it("surfaces provider errors without the key", async () => {
    process.env.NOTIFY_EMAIL_PROVIDER = "resend";
    const fetcher = async () => ({ ok: false, status: 422, json: async () => ({}) });
    await expect(
      sendRangeEmail(input, { fetcher, apiKey: "secret-key", to: "owner@example.com" }),
    ).rejects.toThrow("Resend request failed with status 422");
  });

  it("skips loudly when the provider or credentials are missing", async () => {
    process.env.NOTIFY_EMAIL_PROVIDER = "gmail";
    const res = await sendRangeEmail(input, { fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    expect(res).toEqual({ sent: false, skipped: "provider gmail not supported" });

    process.env.NOTIFY_EMAIL_PROVIDER = "resend";
    delete process.env.NOTIFY_EMAIL_KEY;
    delete process.env.NOTIFY_EMAIL_TO;
    const res2 = await sendRangeEmail(input, { fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    expect(res2).toEqual({ sent: false, skipped: "NOTIFY_EMAIL_KEY/TO not set" });
  });
});
