"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RetroDay = {
  date: string;
  bandLo: number;
  bandHigh: number;
  actual: number;
  covered: boolean;
};

/**
 * Predicted band (translucent accent, UX_SPEC §4.3 item 3) vs recorded
 * truth (solid line). Misses are visible, never clipped: an uncovered day
 * gets a danger-colored dot plus its row flagged in the table below.
 * The table doubles as the chart's non-visual alternative (UX_SPEC §8).
 */

function fmtQ(v: number): string {
  if (v >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RetroBandChart({
  days,
  height = 180,
}: {
  days: RetroDay[];
  height?: number;
}) {
  const data = days.map((d) => ({
    date: d.date.slice(5),
    lo: d.bandLo,
    span: Math.max(0, d.bandHigh - d.bandLo),
    actual: d.actual,
    miss: d.covered ? undefined : d.actual,
  }));
  const hasMiss = days.some((d) => !d.covered);

  return (
    <figure className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#383026" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a89a87" }} />
            <YAxis
              width={48}
              tick={{ fontSize: 10, fill: "#a89a87" }}
              tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
            />
            <Tooltip
              contentStyle={{
                background: "#241e18",
                border: "1px solid #383026",
                borderRadius: 8,
                fontSize: 12,
                color: "#efe6d8",
              }}
              formatter={(value, name) => {
                if (name === "band") return [`${value} m³/s`, "band width"];
                if (name === "miss") return [`${value} m³/s`, "outside band"];
                return [`${value} m³/s`, name === "actual" ? "recorded" : "band floor"];
              }}
            />
            {/* stacked trick: invisible floor + translucent span = the band */}
            <Area dataKey="lo" stackId="band" stroke="none" fill="none" legendType="none" />
            <Area
              dataKey="span"
              stackId="band"
              name="band"
              stroke="none"
              fill="#D99C4E"
              fillOpacity={0.22}
            />
            <Line
              dataKey="actual"
              name="actual"
              stroke="#EFE6D8"
              strokeWidth={2}
              dot={false}
            />
            {hasMiss && (
              <Line
                dataKey="miss"
                name="miss"
                stroke="none"
                dot={{ r: 4, fill: "#E0523F", stroke: "#E0523F" }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        <details className="mt-2 text-xs text-silt-dim">
          <summary className="cursor-pointer hover:text-ochre">
            View every predicted day as a table
          </summary>
          <table className="mt-2 w-full border-collapse text-left font-mono text-[11px]">
            <caption className="sr-only">
              Retrodiction: predicted band versus recorded discharge, misses flagged
            </caption>
            <thead>
              <tr className="text-silt-dim">
                <th scope="col" className="border-b border-stone-edge py-1 pr-4 font-normal">Date</th>
                <th scope="col" className="border-b border-stone-edge py-1 pr-4 font-normal">Predicted band (m³/s)</th>
                <th scope="col" className="border-b border-stone-edge py-1 pr-4 font-normal">Recorded</th>
                <th scope="col" className="border-b border-stone-edge py-1 font-normal">In band</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className={d.covered ? "" : "text-danger"}>
                  <td className="py-1 pr-4">{d.date}</td>
                  <td className="py-1 pr-4">
                    {fmtQ(d.bandLo)} – {fmtQ(d.bandHigh)}
                  </td>
                  <td className="py-1 pr-4">{fmtQ(d.actual)}</td>
                  <td className="py-1">{d.covered ? "yes" : "no — miss shown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </figcaption>
    </figure>
  );
}
