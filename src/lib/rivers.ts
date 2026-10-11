import type { RangeState } from "@/lib/status";

export type River = {
  id: string;
  name: string;
  stretch: string;
  /** Native-script name — Urdu scout queries + the relevance gate (P75-4) */
  urduName: string;
  cell: { lat: number; lon: number };
  /** GloFAS cell elevation in meters — shown for transparency */
  cellElevation: number;
  /** Trust state of the runnable range (DATA_DICTIONARY §8.1) */
  rangeState: RangeState;
  /** Runnable discharge range in m³/s. Present only when rangeState is "verified" */
  runnableRange: [number, number] | null;
  note: string;
};

/**
 * GloFAS grid cells chosen by sweeping ~40 cells per basin and validating
 * against the Jul–Sep 2022 monsoon record (see docs/deep-dive.md).
 */
export const RIVERS: River[] = [
  {
    id: "indus-besham",
    name: "Indus",
    stretch: "Besham stretch (KKH)",
    urduName: "سندھ",
    cell: { lat: 34.88, lon: 72.88 },
    cellElevation: 633,
    rangeState: "unverified",
    runnableRange: null,
    note: "Flagship river — big, clean snowmelt hydrograph. Peaked at 12,022 m³/s in the July 2022 record.",
  },
  {
    id: "kunhar-balakot",
    name: "Kunhar",
    stretch: "Balakot stretch (Kaghan Valley)",
    urduName: "کنہار",
    cell: { lat: 34.58, lon: 73.33 },
    cellElevation: 1397,
    rangeState: "verified",
    runnableRange: [35,135],
    note: "Rafting spot. Clean snowmelt curve; Jul 2022 peak 193 m³/s.",
  },
  {
    id: "swat-mingora",
    name: "Swat",
    stretch: "Lower river, Mingora",
    urduName: "سوات",
    cell: { lat: 34.77, lon: 72.38 },
    cellElevation: 931,
    rangeState: "unverified",
    runnableRange: null,
    note: "Rafting runs happen upstream (Kalam–Bahrain); this well-resolved lower cell is a proxy. Flatter signal.",
  },
  {
    id: "malir-karachi",
    name: "Malir",
    stretch: "Karachi",
    urduName: "ملیر",
    cell: { lat: 24.93, lon: 67.18 },
    cellElevation: 34,
    rangeState: "not_a_paddling_river",
    runnableRange: null,
    note: "The honesty check: an ephemeral channel — reads dry almost always, spikes only in monsoon. Not a paddling river.",
  },
];
