/**
 * Season calendar (P75-10) — static climatology for Pakistan's snowmelt
 * rivers, NOT a forecast. It exists to explain chart shapes: why April
 * rises, why July is huge, why October fades. Ranges are inclusive month
 * numbers (1–12); first match wins for the "current" label.
 */
export type Season = {
  name: string;
  months: number[]; // 1 = Jan … 12 = Dec
  blurb: string;
};

export const SEASONS: Season[] = [
  {
    name: "Winter low",
    months: [12, 1, 2],
    blurb: "Frozen catchments — rivers at their minimum. Most runs are closed or too cold.",
  },
  {
    name: "Snowmelt rise",
    months: [3, 4, 5],
    blurb: "Sun works on the snowpack — steady daily rise, cold water, building rapids.",
  },
  {
    name: "Peak + monsoon",
    months: [6, 7, 8],
    blurb: "Glacier melt and monsoon rain overlap — the big water months, and the dangerous ones.",
  },
  {
    name: "Autumn fade",
    months: [9, 10, 11],
    blurb: "Melt tapers off — clearing water, lower flows, the classic autumn paddling season.",
  },
];

export function seasonForMonth(month: number): Season {
  return SEASONS.find((s) => s.months.includes(month)) ?? SEASONS[0];
}
