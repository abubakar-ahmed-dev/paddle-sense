export type RangeState = "verified" | "unverified" | "not_a_paddling_river";

export type Status =
  | "no_data"
  | "not_a_paddling_river"
  | "range_unverified"
  | "dry"
  | "in_range"
  | "high_water_dangerous";

/**
 * Deterministic safety status — the ONLY source of status in the product
 * (DATA_DICTIONARY §8.5). The LLM never decides this.
 *
 * Precedence: no_data → not_a_paddling_river → range_unverified → thresholds.
 */
export function computeStatus(input: {
  discharge: number | null;
  rangeState: RangeState;
  runnable?: [number, number] | null;
}): Status {
  const { discharge, rangeState, runnable } = input;
  if (discharge === null || Number.isNaN(discharge)) return "no_data";
  if (rangeState === "not_a_paddling_river") return "not_a_paddling_river";
  if (rangeState !== "verified" || !runnable) return "range_unverified";
  const [lo, hi] = runnable;
  if (discharge <= lo) return "dry";
  if (discharge >= hi) return "high_water_dangerous";
  return "in_range";
}
