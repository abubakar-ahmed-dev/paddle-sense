import { describe, expect, it } from "vitest";
import { computeStatus } from "@/lib/status";

/**
 * Truth table for DATA_DICTIONARY §8.5 — the ONLY source of safety status.
 * 100% of the documented rules must pass (TESTING.md gate, Phase 2).
 */
describe("computeStatus", () => {
  const verified = {
    rangeState: "verified" as const,
    runnable: [100, 500] as [number, number],
  };

  it("returns no_data when discharge is null (before all other rules)", () => {
    expect(computeStatus({ discharge: null, rangeState: "verified", runnable: [100, 500] })).toBe("no_data");
    expect(computeStatus({ discharge: null, rangeState: "unverified", runnable: null })).toBe("no_data");
    expect(computeStatus({ discharge: null, rangeState: "not_a_paddling_river", runnable: null })).toBe("no_data");
  });

  it("returns no_data for NaN (treats garbage as absence)", () => {
    expect(computeStatus({ discharge: Number.NaN, rangeState: "verified", runnable: [100, 500] })).toBe("no_data");
  });

  it("not_a_paddling_river wins over any threshold logic", () => {
    expect(computeStatus({ discharge: 0, rangeState: "not_a_paddling_river", runnable: null })).toBe("not_a_paddling_river");
    expect(computeStatus({ discharge: 9999, rangeState: "not_a_paddling_river", runnable: null })).toBe("not_a_paddling_river");
  });

  it("returns range_unverified when the range is not verified", () => {
    expect(computeStatus({ discharge: 300, rangeState: "unverified", runnable: null })).toBe("range_unverified");
  });

  it("returns range_unverified when verified but bounds are missing (invariant R1)", () => {
    expect(computeStatus({ discharge: 300, rangeState: "verified", runnable: null })).toBe("range_unverified");
  });

  it("dry when discharge is at or below the lower bound", () => {
    expect(computeStatus({ discharge: 50, ...verified })).toBe("dry");
    expect(computeStatus({ discharge: 100, ...verified })).toBe("dry"); // boundary: <= lo
  });

  it("in_range strictly between bounds", () => {
    expect(computeStatus({ discharge: 100.1, ...verified })).toBe("in_range");
    expect(computeStatus({ discharge: 300, ...verified })).toBe("in_range");
    expect(computeStatus({ discharge: 499.9, ...verified })).toBe("in_range");
  });

  it("high_water_dangerous at or above the upper bound", () => {
    expect(computeStatus({ discharge: 500, ...verified })).toBe("high_water_dangerous"); // boundary: >= hi
    expect(computeStatus({ discharge: 900, ...verified })).toBe("high_water_dangerous");
  });

  it("realistic Malir reading stays not_a_paddling_river, not dry", () => {
    // 0.10 m³/s with a hypothetical [0,0]-style range must NOT become in_range
    expect(computeStatus({ discharge: 0.1, rangeState: "not_a_paddling_river", runnable: null })).toBe("not_a_paddling_river");
  });
});
