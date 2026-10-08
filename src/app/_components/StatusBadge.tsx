import type { Status } from "@/lib/status";

/** Exact badge copy per UX_SPEC §6 — never improvised, never contains "safe". */
const BADGES: Record<Status, { label: string; className: string }> = {
  in_range: {
    label: "In runnable range",
    className: "text-status-in-range border-water/40",
  },
  dry: {
    label: "Below runnable — dry",
    className: "text-status-dry border-stone-edge",
  },
  high_water_dangerous: {
    label: "HIGH WATER — do not go",
    className: "text-status-high border-danger/50",
  },
  range_unverified: {
    label: "Range not yet verified",
    className: "text-status-unverified border-attention/40",
  },
  not_a_paddling_river: {
    label: "Not a paddling river",
    className: "text-status-not-paddle border-stone-edge",
  },
  no_data: {
    label: "No data",
    className: "text-silt-dim border-stone-edge",
  },
};

export default function StatusBadge({ status }: { status: Status }) {
  const badge = BADGES[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}
