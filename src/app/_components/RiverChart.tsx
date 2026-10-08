"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DischargeSeries } from "@/lib/flood";

/**
 * Water hue (#8FC6C2) is DATA-ONLY per UX_SPEC §2 — it appears here and in
 * water references, never on buttons or status badges.
 */
export default function RiverChart({
  series,
  today,
  height = 160,
}: {
  series: DischargeSeries;
  today: string;
  height?: number;
}) {
  const data = series.time.map((t, i) => ({
    date: t.slice(5),
    observed: t < today ? series.discharge[i] : undefined,
    forecast: t >= today ? series.discharge[i] : undefined,
  }));
  const tableRows = series.time
    .map((t, i) => ({ date: t, q: series.discharge[i] }))
    .slice(-14);

  return (
    <figure className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="water-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8FC6C2" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#8FC6C2" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#383026" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a89a87" }} />
            <YAxis
              width={44}
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
              formatter={(value) => [`${value} m³/s`, "discharge"]}
            />
            <ReferenceLine
              x={today.slice(5)}
              stroke="#d99c4e"
              strokeDasharray="4 3"
              label={{
                value: "today",
                fill: "#d99c4e",
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
            <Area
              type="monotone"
              dataKey="observed"
              stroke="#8FC6C2"
              strokeWidth={2}
              fill="url(#water-gradient)"
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="forecast"
              stroke="#5DA39E"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              fill="url(#water-gradient)"
              fillOpacity={0.4}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* non-visual chart alternative (UX_SPEC §8): last 14 days as a table */}
      <figcaption>
        <details className="mt-2 text-xs text-silt-dim">
          <summary className="cursor-pointer hover:text-ochre">
            View the latest readings as a table
          </summary>
          <table className="mt-2 w-full border-collapse text-left font-mono text-[11px]">
            <thead>
              <tr className="text-silt-dim">
                <th scope="col" className="border-b border-stone-edge py-1 pr-4 font-normal">
                  Date
                </th>
                <th scope="col" className="border-b border-stone-edge py-1 font-normal">
                  Discharge (m³/s)
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.date}>
                  <td className="py-1 pr-4">{row.date}</td>
                  <td className="py-1">{row.q === null ? "—" : row.q.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </figcaption>
    </figure>
  );
}
