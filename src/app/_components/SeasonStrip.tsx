import { seasonForMonth } from "@/lib/seasons";

/**
 * Thin climatology strip above each chart (P75-10): which part of the
 * water year you're looking at. Static knowledge — labeled as such, never
 * styled like a forecast. The current month's segment is highlighted.
 */
export default function SeasonStrip({ today }: { today: string }) {
  const month = Number(today.slice(5, 7));
  const current = seasonForMonth(month);
  const monthNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <div className="mb-2">
      <div
        aria-hidden="true"
        className="flex h-1.5 w-full overflow-hidden rounded-full"
      >
        {Array.from({ length: 12 }, (_, i) => {
          const season = seasonForMonth(i + 1);
          const isNow = i + 1 === month;
          return (
            <div
              key={i}
              className={
                isNow
                  ? "border-x border-stone/80 bg-ochre"
                  : season.name === "Peak + monsoon"
                    ? "bg-water/50"
                    : season.name === "Winter low"
                      ? "bg-stone-edge"
                      : "bg-silt-dim/40"
              }
              style={{ width: `${100 / 12}%` }}
            />
          );
        })}
      </div>
      {/* one compact line: months left, current season right. The per-season
          blurb moved out of the card — the strip labels itself, the river
          page keeps the detail. */}
      <p className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-silt-dim">
        <span aria-hidden="true" className="font-mono tracking-[0.2em]">
          {monthNames.map((m, i) => (
            <span
              key={i}
              className={i + 1 === month ? "font-semibold text-ochre" : undefined}
            >
              {m}
            </span>
          ))}
        </span>
        <span>
          now: <span className="text-silt">{current.name}</span> · climatology,
          not a forecast
        </span>
      </p>
    </div>
  );
}
