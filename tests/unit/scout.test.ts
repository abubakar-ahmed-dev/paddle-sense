import { describe, it, expect } from "vitest";
import {
  CFS_TO_CMS,
  extractRangeCandidates,
  classifyNote,
  formatRangeText,
  normalizeQuery,
  queryHash,
  queryTemplates,
  scoutedRivers,
  currentMonth,
  riverRelevant,
  riverTokens,
} from "@/lib/scout";

const src = { url: "https://example.com/guide", title: "Guide" };

describe("extractRangeCandidates (P5-5/P5-6)", () => {
  it('"between X and Y cfs" extracts the band and converts to m³/s', () => {
    const [c] = extractRangeCandidates("Raftable between 500 and 2,000 cfs.", src);
    expect(c.unit).toBe("cfs");
    expect(c.lo).toBe(500);
    expect(c.hi).toBe(2000);
    expect(c.loM3s).toBeCloseTo(500 * CFS_TO_CMS, 10);
    expect(c.hiM3s).toBeCloseTo(2000 * CFS_TO_CMS, 10);
    expect(c.quote).toBe("Raftable between 500 and 2,000 cfs.");
    expect(c.url).toBe(src.url);
  });

  it('"between X cfs and Y cfs" (unit on both numbers) works', () => {
    const [c] = extractRangeCandidates("between 500 cfs and 2,000 cfs", src);
    expect(c.lo).toBe(500);
    expect(c.hi).toBe(2000);
    expect(c.unit).toBe("cfs");
  });

  it("en-dash span with m³/s passes through unconverted", () => {
    const [c] = extractRangeCandidates("best at 150–400 m³/s", src);
    expect(c.unit).toBe("m3/s");
    expect(c.lo).toBe(150);
    expect(c.hi).toBe(400);
    expect(c.loM3s).toBe(150);
  });

  it('"X to Y cms" is recognized as m³/s', () => {
    const [c] = extractRangeCandidates("runs 100 to 600 cms", src);
    expect(c.unit).toBe("m3/s");
    expect(c.hi).toBe(600);
  });

  it("minimum-only forms give a lo candidate with unknown hi", () => {
    for (const snippet of ["minimum of 300 cfs", "at least 300 cfs", "above 300 cfs"]) {
      const [c] = extractRangeCandidates(snippet, src);
      expect(c.lo).toBe(300);
      expect(c.hi).toBeNull();
      expect(c.hiM3s).toBeNull();
    }
  });

  it("a range without a unit is discarded, not guessed", () => {
    expect(extractRangeCandidates("between 500 and 2,000", src)).toHaveLength(0);
    expect(extractRangeCandidates("from 1,422 to 1,616", src)).toHaveLength(0);
  });

  it("prose without ranges returns nothing", () => {
    expect(
      extractRangeCandidates("The Indus peaked at 12,022 m³/s in July 2022.", src),
    ).toHaveLength(0);
  });

  it("an inverted band is rejected (invariant R2 could never hold)", () => {
    expect(extractRangeCandidates("between 2,000 and 500 cfs", src)).toHaveLength(0);
  });

  it("duplicate matches in one snippet dedup to one candidate", () => {
    const found = extractRangeCandidates("150–400 cfs. It says again: 150–400 cfs.", src);
    expect(found).toHaveLength(1);
  });
});

describe("formatRangeText (P5-6 labeling)", () => {
  it("shows raw units first and the m³/s conversion labeled as approximate", () => {
    const [c] = extractRangeCandidates("between 500 and 2,000 cfs", src);
    const text = formatRangeText(c);
    expect(text).toContain("500–2,000 cfs");
    expect(text).toContain("m³/s");
    expect(text).toContain("≈");
  });
});

describe("classifyNote (P5-8 keyword gates)", () => {
  it("closure wins over operator wording", () => {
    const note = classifyNote({
      link: "https://x.com/a",
      title: "Rafting update",
      snippet: "All rafting trips closed until further notice.",
    });
    expect(note?.kind).toBe("closure");
  });

  it("access vocabulary is gated", () => {
    const note = classifyNote({
      link: "https://x.com/b",
      title: "Trip logistics",
      snippet: "Put-in near the Kalam bridge; takeout at Bahrain.",
    });
    expect(note?.kind).toBe("access");
  });

  it("operator pages are gated", () => {
    const note = classifyNote({
      link: "https://x.com/c",
      title: "Kunhar rafting",
      snippet: "A licensed operator runs guided trips all summer.",
    });
    expect(note?.kind).toBe("operator");
  });

  it("irrelevant results are discarded, not guessed", () => {
    expect(
      classifyNote({
        link: "https://x.com/d",
        title: "History",
        snippet: "The Indus Valley Civilization flourished along the river.",
      }),
    ).toBeNull();
  });

  it("results without link or snippet are never notes", () => {
    expect(classifyNote({ title: "t", snippet: "rafting put-in access" })).toBeNull();
    expect(classifyNote({ link: "https://x.com/e", title: "t" })).toBeNull();
  });
});

describe("riverRelevant (P5-8: about THIS river, not just the vocabulary)", () => {
  const indus = { name: "Indus", stretch: "Besham stretch (KKH)" };
  const kunhar = { name: "Kunhar", stretch: "Balakot stretch (Kaghan Valley)" };

  it("US guidebook content found by the query template is NOT about the Indus", () => {
    expect(
      riverRelevant(
        "On the Rio Grande, we consider low water to be below 300 cfs, medium water 300–600 cfs.",
        indus,
      ),
    ).toBe(false);
    expect(
      riverRelevant("Blue River. Understanding the CFS range: 300-600 CFS – scenic.", indus),
    ).toBe(false);
  });

  it("pages naming the river or a stretch proper noun pass", () => {
    expect(riverRelevant("Indus discharge at Besham remains high", indus)).toBe(true);
    expect(riverRelevant("Rafting the Kunhar from Balakot", kunhar)).toBe(true);
    expect(riverRelevant("Kaghan Valley road update", kunhar)).toBe(true);
  });

  it("generic stretch words are stoplisted — 'lower river' alone is not Swat", () => {
    const swat = { name: "Swat", stretch: "Lower river, Mingora" };
    expect(riverRelevant("The lower river section is popular", swat)).toBe(false);
    expect(riverRelevant("Mingora rafting conditions", swat)).toBe(true);
  });

  it("token list keeps only proper nouns (min 3 chars)", () => {
    expect(riverTokens(indus)).toEqual(["indus", "besham", "kkh"]);
  });
});

describe("query identity + templates", () => {
  it("normalizeQuery collapses case and whitespace; hashes are stable", () => {
    expect(normalizeQuery("  Indus   Rafting levels ")).toBe("indus rafting levels");
    expect(queryHash("Indus  Rafting")).toBe(queryHash("indus rafting"));
  });

  it("currentMonth is YYYY-MM UTC", () => {
    expect(currentMonth(new Date("2026-10-09T12:00:00Z"))).toBe("2026-10");
  });

  it("queryTemplates follow docs/API.md §3.3 (3 per river)", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const templates = queryTemplates({ name: "Indus", stretch: "Besham" }, now);
    expect(templates.map(([kind]) => kind)).toEqual(["range", "access", "closure"]);
    const closure = templates[2][1];
    expect(closure).toContain("closed");
    expect(closure).toContain("October");
    expect(closure).toContain("2026");
  });

  it("Malir is never scouted (its state is config, not searchable)", () => {
    const ids = scoutedRivers().map((r) => r.id);
    expect(ids).toEqual(["indus-besham", "kunhar-balakot", "swat-mingora"]);
    expect(ids).not.toContain("malir-karachi");
  });
});
